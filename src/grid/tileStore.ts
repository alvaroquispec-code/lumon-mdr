import { ApiError, requestRaw, retryAfterMs, sleep } from '../api/http';
import type { Bin, Rules, TileDto } from '../api/types';

export interface Tile {
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: Uint8Array;
  bins: string[];
  version: number;
}

export const BIN_CHAR: Record<Bin, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' };

function decodeB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Inflight { ctrl: AbortController; promise: Promise<Tile>; pinned: boolean }

const MAX_CONCURRENT = 4;

export class TileStore {
  readonly tileRows: number;
  readonly tileCols: number;
  private tiles = new Map<string, Tile>();
  private inflight = new Map<string, Inflight>();
  private blockedUntil = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  private listeners = new Set<() => void>();
  private disposed = false;
  requested = 0;

  constructor(readonly fileId: number, readonly rows: number, readonly cols: number, readonly tileSize: number) {
    this.tileRows = Math.ceil(rows / tileSize);
    this.tileCols = Math.ceil(cols / tileSize);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void { this.listeners.forEach((l) => l()); }

  static key(tr: number, tc: number): string { return `${tr},${tc}`; }

  getTile(tr: number, tc: number): Tile | undefined { return this.tiles.get(TileStore.key(tr, tc)); }

  /** Devuelve [valor, tremor, bin] o null si el bloque no está cargado. */
  cell(r: number, c: number): { v: number; t: number; b: string } | null {
    const t = this.tiles.get(TileStore.key(Math.floor(r / this.tileSize), Math.floor(c / this.tileSize)));
    if (!t) return null;
    const i = (r - t.originRow) * t.cols + (c - t.originCol);
    return { v: t.values.charCodeAt(i) - 48, t: t.tremor[i], b: t.bins[i] };
  }

  setBin(r: number, c: number, ch: string): void {
    const t = this.tiles.get(TileStore.key(Math.floor(r / this.tileSize), Math.floor(c / this.tileSize)));
    if (!t) return;
    t.bins[(r - t.originRow) * t.cols + (c - t.originCol)] = ch;
  }
  notify(): void { this.emit(); }

  invalidate(keys: Array<[number, number]>): void {
    for (const [tr, tc] of keys) this.tiles.delete(TileStore.key(tr, tc));
    this.emit();
  }

  /** Bloques que necesita la vista: cancela los demás pedidos no fijados. */
  want(keys: Array<[number, number]>): void {
    const wanted = new Set(keys.map(([a, b]) => TileStore.key(a, b)));
    for (const [k, f] of this.inflight) {
      if (!f.pinned && !wanted.has(k)) {
        f.ctrl.abort();
        this.inflight.delete(k);
      }
    }
    for (const [tr, tc] of keys) {
      this.ensure(tr, tc, false).catch(() => { /* cancelado o error: se reintenta al volver a la vista */ });
    }
  }

  ensure(tr: number, tc: number, pinned: boolean): Promise<Tile> {
    const k = TileStore.key(tr, tc);
    const have = this.tiles.get(k);
    if (have) return Promise.resolve(have);
    const cur = this.inflight.get(k);
    if (cur) {
      if (pinned) cur.pinned = true;
      return cur.promise;
    }
    const ctrl = new AbortController();
    const entry: Inflight = { ctrl, pinned, promise: Promise.resolve(null as unknown as Tile) };
    entry.promise = this.load(tr, tc, ctrl.signal).finally(() => {
      if (this.inflight.get(k) === entry) this.inflight.delete(k);
    });
    this.inflight.set(k, entry);
    return entry.promise;
  }

  private async slot(signal: AbortSignal): Promise<void> {
    while (this.active >= MAX_CONCURRENT) {
      await new Promise<void>((res) => this.waiters.push(res));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    }
    this.active += 1;
  }
  private release(): void {
    this.active -= 1;
    const w = this.waiters.shift();
    if (w) w();
  }

  private async load(tr: number, tc: number, signal: AbortSignal): Promise<Tile> {
    let attempt = 0;
    for (;;) {
      const wait = this.blockedUntil - Date.now();
      if (wait > 0) await sleep(wait, signal);
      await this.slot(signal);
      try {
        if (Date.now() < this.blockedUntil) continue;
        this.requested += 1;
        const res = await requestRaw<TileDto>(`/files/${this.fileId}/tiles/${tr}/${tc}`, { signal, retries503: 0 });
        const d = res.data;
        const tile: Tile = {
          originRow: d.originRow, originCol: d.originCol, rows: d.rows, cols: d.cols,
          values: d.values, tremor: decodeB64(d.tremor), bins: d.bins.split(''), version: d.version,
        };
        if (!this.disposed) {
          this.tiles.set(TileStore.key(tr, tc), tile);
          this.emit();
        }
        return tile;
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) {
          this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryAfterMs(e.headers, 1000));
          continue;
        }
        if (e instanceof ApiError && e.status === 503 && attempt < 6) {
          await sleep(retryAfterMs(e.headers, 0) + 400 * 2 ** attempt, signal).catch(() => undefined);
          attempt += 1;
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          continue;
        }
        if (e instanceof TypeError && attempt < 4 && !signal.aborted) {
          await sleep(500 * 2 ** attempt, signal);
          attempt += 1;
          continue;
        }
        throw e;
      } finally {
        this.release();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.inflight.values()) f.ctrl.abort();
    this.inflight.clear();
    this.listeners.clear();
  }
}

export interface GroupInfo {
  cells: Array<{ r: number; c: number }>;
  bin: Bin | null;
  noise: boolean;
  refined: boolean;
}

export function binFor(rules: Rules, digits: number[]): Bin {
  const idx = rules.binning.strategy === 'DIGIT_SUM_MOD'
    ? digits.reduce((a, b) => a + b, 0) % 4
    : Math.max(...digits) % 4;
  return rules.binning.order[idx];
}

/** Componente conexo máximo de celdas que dan miedo, pidiendo los bloques que falten. */
export async function findGroup(store: TileStore, rules: Rules, r0: number, c0: number): Promise<GroupInfo | null> {
  const thr = rules.tremorThreshold;
  const get = async (r: number, c: number) => {
    let cell = store.cell(r, c);
    if (!cell) {
      await store.ensure(Math.floor(r / store.tileSize), Math.floor(c / store.tileSize), true);
      cell = store.cell(r, c);
    }
    return cell;
  };
  const start = await get(r0, c0);
  if (!start || start.t < thr) return null;
  const dirs: Array<[number, number]> = rules.connectivity === 8
    ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const seen = new Set<number>([r0 * store.cols + c0]);
  const queue: Array<[number, number]> = [[r0, c0]];
  const cells: Array<{ r: number; c: number }> = [];
  const digits: number[] = [];
  let refined = false;
  while (queue.length) {
    const [r, c] = queue.shift() as [number, number];
    const cell = await get(r, c);
    if (!cell) continue;
    cells.push({ r, c });
    digits.push(cell.v);
    if (cell.b !== '.') refined = true;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= store.rows || nc >= store.cols) continue;
      const id = nr * store.cols + nc;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = await get(nr, nc);
      if (n && n.t >= thr) queue.push([nr, nc]);
    }
  }
  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  const noise = cells.length < rules.minGroupSize || cells.length > rules.maxGroupSize;
  return { cells, bin: noise ? null : binFor(rules, digits), noise, refined };
}
