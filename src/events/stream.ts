import { API_BASE } from '../config';
import { ApiError, api, sleep } from '../api/http';
import { revoke } from '../auth/session';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed-floor' | 'follower';
export interface LumonEvent { type: string; id: number | null; data: unknown }

const EVENT_TYPES = [
  'refiner.updated', 'refinement.created', 'file.completed', 'contingency.activated',
  'contingency.resolved', 'session.revoked', 'stream.reset', 'stream.superseded',
];
const LAST_KEY = 'lumon.lastEventId';

type BcMsg = { kind: 'event'; ev: LumonEvent } | { kind: 'status'; status: StreamStatus } | { kind: 'hello' };
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-events') : null;

const listeners = new Set<(e: LumonEvent) => void>();
const statusListeners = new Set<(s: StreamStatus) => void>();
let status: StreamStatus = 'idle';
let leaderStatus: StreamStatus = 'idle';
let isLeader = false;
const seen = new Set<number>();
const seenOrder: number[] = [];

function setStatus(s: StreamStatus): void {
  status = s;
  statusListeners.forEach((l) => l(s));
}
function setLeaderStatus(s: StreamStatus): void {
  leaderStatus = s;
  setStatus(s);
  bc?.postMessage({ kind: 'status', status: s } satisfies BcMsg);
}

function readLast(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
function writeLast(id: number): void {
  try {
    const cur = Number(localStorage.getItem(LAST_KEY) ?? '0');
    if (!Number.isFinite(cur) || id > cur) localStorage.setItem(LAST_KEY, String(id));
  } catch { /* ignore */ }
}

function deliver(ev: LumonEvent): void {
  if (ev.id !== null) {
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    seenOrder.push(ev.id);
    if (seenOrder.length > 2000) seen.delete(seenOrder.shift() as number);
  }
  if (ev.type === 'session.revoked') {
    const d = ev.data as { reason?: string } | null;
    revoke(d?.reason === 'REFRESH_REUSED' ? 'REFRESH_REUSED' : 'LOGOUT');
  }
  listeners.forEach((l) => l(ev));
}

bc?.addEventListener('message', (m: MessageEvent<BcMsg>) => {
  const msg = m.data;
  if (msg.kind === 'event') deliver(msg.ev);
  else if (msg.kind === 'status' && !isLeader) setStatus(msg.status === 'open' ? 'open' : msg.status);
  else if (msg.kind === 'hello' && isLeader) bc.postMessage({ kind: 'status', status: leaderStatus } satisfies BcMsg);
});

export function subscribeEvents(fn: (e: LumonEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function subscribeStatus(fn: (s: StreamStatus) => void): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

async function leaderLoop(signal: AbortSignal): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    setLeaderStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      ticket = (await api<{ ticket: string }>('/events/tickets', { method: 'POST', signal })).ticket;
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.status === 423) {
        setLeaderStatus('closed-floor');
        await sleep(30000, signal).catch(() => undefined);
        continue;
      }
      if (e instanceof ApiError && e.status === 401 && e.code !== 'TOKEN_EXPIRED') return;
      await sleep(Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500, signal).catch(() => undefined);
      attempt += 1;
      continue;
    }
    let superseded = false;
    await new Promise<void>((resolve) => {
      const last = readLast();
      const qs = new URLSearchParams({ ticket });
      if (last) qs.set('lastEventId', last);
      const es = new EventSource(`${API_BASE}/events/stream?${qs}`);
      let dead = 0;
      const finish = () => { window.clearTimeout(dead); es.close(); signal.removeEventListener('abort', finish); resolve(); };
      const bump = () => { window.clearTimeout(dead); dead = window.setTimeout(finish, 45000); };
      signal.addEventListener('abort', finish, { once: true });
      es.onopen = () => { attempt = 0; setLeaderStatus('open'); bump(); };
      es.onmessage = () => bump();
      es.onerror = () => finish();
      for (const t of EVENT_TYPES) {
        es.addEventListener(t, (raw: MessageEvent<string>) => {
          bump();
          let data: unknown = null;
          try { data = JSON.parse(raw.data); } catch { /* datos no JSON */ }
          const idNum = raw.lastEventId ? Number(raw.lastEventId) : NaN;
          const id = t === 'stream.superseded' || !Number.isFinite(idNum) ? null : idNum;
          if (id !== null) writeLast(id);
          if (t === 'stream.superseded') { superseded = true; finish(); return; }
          const ev: LumonEvent = { type: t, id, data };
          bc?.postMessage({ kind: 'event', ev } satisfies BcMsg);
          deliver(ev);
        });
      }
      bump();
    });
    if (signal.aborted) return;
    setLeaderStatus('reconnecting');
    await sleep(superseded ? 10000 : Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500, signal).catch(() => undefined);
    attempt += 1;
  }
}

let stopper: AbortController | null = null;

/** Una sola conexión por navegador: la pestaña con el lock es la líder y reparte los eventos. */
export function startEvents(): () => void {
  if (stopper) return () => undefined;
  const ctrl = new AbortController();
  stopper = ctrl;
  setStatus('follower');
  bc?.postMessage({ kind: 'hello' } satisfies BcMsg);
  const run = async () => {
    isLeader = true;
    try { await leaderLoop(ctrl.signal); } finally { isLeader = false; }
  };
  if (navigator.locks) {
    navigator.locks.request('lumon-sse', { signal: ctrl.signal }, run).catch(() => undefined);
  } else {
    void run();
  }
  return () => { ctrl.abort(); stopper = null; setStatus('idle'); };
}
