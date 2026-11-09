import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorText, isRecord, requestRaw, retryAfterMs, sleep } from '../api/http';
import { BINS, type Bin, type LumonFile, type Progress, type RefineResult, type Rules } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { BIN_CHAR, TileStore, findGroup, type GroupInfo } from './tileStore';

const CELL = 26;
const MAX_CELLS = 2400;
const BIN_STYLE: Record<string, string> = { W: 'bg-sky-800', F: 'bg-emerald-800', D: 'bg-rose-900', M: 'bg-amber-800' };
const BIN_NAME: Record<Bin, string> = { WO: 'WO', FC: 'FC', DR: 'DR', MA: 'MA' };

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

const reasonText: Record<string, string> = {
  BELOW_THRESHOLD: 'el grupo incluye celdas que no dan miedo',
  NOT_CONNECTED: 'las celdas no están conectadas',
  INCOMPLETE: 'el grupo está incompleto',
  SIZE_OUT_OF_RANGE: 'el grupo es ruido (tamaño fuera de rango)',
};

export default function RefinePage() {
  const { id: idParam } = useParams();
  const fileId = Number(idParam);
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [file, setFile] = useState<LumonFile | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(fileId) || fileId <= 0) { setLoadError('Archivo inválido.'); return; }
    const ctrl = new AbortController();
    setLoadError(null);
    Promise.all([
      api<LumonFile>(`/files/${fileId}`, { signal: ctrl.signal }),
      api<Rules>(`/files/${fileId}/rules`, { signal: ctrl.signal }),
    ]).then(([f, r]) => { setFile(f); setRules(r); })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoadError(e instanceof ApiError && e.status === 404 ? 'Este archivo no existe.' : errorText(e));
      });
    return () => ctrl.abort();
  }, [fileId, reload]);

  if (loadError) {
    return (
      <section role="alert" className="p-6">
        <p>{loadError}</p>
        <button className="mt-2 underline" onClick={() => setReload((n) => n + 1)}>Reintentar</button>{' '}
        <Link className="ml-3 text-teal-300 underline" to="/files">Volver</Link>
      </section>
    );
  }
  if (!file || !rules) return <p role="status" className="p-6 text-slate-300">Abriendo archivo…</p>;
  return (
    <Refiner key={file.id} file={file} rules={rules} params={params} setParams={setParams} canRefine={can('files:refine')} />
  );
}

interface RefinerProps {
  file: LumonFile;
  rules: Rules;
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
  canRefine: boolean;
}

function clampInt(v: string | null, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, Math.max(0, max - 1)) : 0;
}

function Refiner({ file, rules, params, setParams, canRefine }: RefinerProps) {
  const store = useMemo(() => new TileStore(file.id, file.rows, file.cols, file.tileSize), [file]);
  useEffect(() => () => store.dispose(), [store]);
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);

  const [progress, setProgress] = useState<Progress>(file.progress);
  const [stats, setStats] = useState({ refined: file.refinedGroups, total: file.totalGroups, mistakes: file.mistakes, status: file.status });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 800, h: 500 });
  const initR = clampInt(params.get('r'), file.rows);
  const initC = clampInt(params.get('c'), file.cols);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: initR, c: initC });
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const intentRef = useRef<{ key: string; body: string } | null>(null);
  const focusFromKeyboard = useRef(false);

  // posición inicial
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = initR * CELL;
    el.scrollLeft = initC * CELL;
    setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight }));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // rango visible
  let r0 = Math.floor(view.top / CELL);
  let c0 = Math.floor(view.left / CELL);
  let nr = Math.ceil(view.h / CELL) + 2;
  let nc = Math.ceil(view.w / CELL) + 2;
  while (nr * nc > MAX_CELLS) { if (nc > nr) nc -= 1; else nr -= 1; }
  r0 = Math.max(0, Math.min(r0, file.rows - 1));
  c0 = Math.max(0, Math.min(c0, file.cols - 1));
  const r1 = Math.min(file.rows, r0 + nr);
  const c1 = Math.min(file.cols, c0 + nc);

  // URL con la posición (sin llenar el historial)
  useEffect(() => {
    const t = setTimeout(() => {
      if (params.get('r') === String(r0) && params.get('c') === String(c0)) return;
      const p = new URLSearchParams(params);
      p.set('r', String(r0));
      p.set('c', String(c0));
      setParams(p, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [r0, c0, params, setParams]);

  // pedir bloques visibles (con debounce ligero)
  useEffect(() => {
    const t = setTimeout(() => {
      const ts = file.tileSize;
      const keys: Array<[number, number]> = [];
      for (let tr = Math.floor(r0 / ts); tr <= Math.floor((r1 - 1) / ts); tr++) {
        for (let tc = Math.floor(c0 / ts); tc <= Math.floor((c1 - 1) / ts); tc++) keys.push([tr, tc]);
      }
      store.want(keys);
    }, 60);
    return () => clearTimeout(t);
  }, [r0, r1, c0, c1, store, file.tileSize]);

  const selectedSet = useMemo(() => new Set(group?.cells.map((x) => x.r * file.cols + x.c)), [group, file.cols]);

  const selectAt = useCallback(async (r: number, c: number) => {
    const cell = store.cell(r, c);
    if (!cell) return;
    if (cell.t < rules.tremorThreshold) { setGroup(null); return; }
    setSelecting(true);
    setMsg(null);
    try {
      const g = await findGroup(store, rules, r, c);
      setGroup(g);
      intentRef.current = null;
    } catch (e) {
      setMsg({ kind: 'err', text: `No se pudo cargar el grupo completo: ${errorText(e)}` });
    } finally {
      setSelecting(false);
    }
  }, [store, rules]);

  const refine = useCallback(async (bin: Bin) => {
    if (!group || group.noise || group.refined || pendingRef.current || !canRefine) return;
    pendingRef.current = true;
    setPending(true);
    setMsg({ kind: 'info', text: `Llevando grupo a ${bin}…` });
    const body = { bin, cells: group.cells };
    const bodyStr = JSON.stringify(body);
    if (!intentRef.current || intentRef.current.body !== bodyStr) intentRef.current = { key: uuid(), body: bodyStr };
    const key = intentRef.current.key;
    let attempt = 0;
    try {
      for (;;) {
        try {
          const res = await requestRaw<RefineResult>(`/files/${file.id}/refinements`, {
            method: 'POST', body, headers: { 'Idempotency-Key': key }, retries503: 0,
          });
          const ch = BIN_CHAR[res.data.bin];
          for (const x of group.cells) store.setBin(x.r, x.c, ch);
          store.notify();
          setProgress(res.data.file.progress);
          setStats({ refined: res.data.file.refinedGroups, total: res.data.file.totalGroups, mistakes: res.data.file.mistakes, status: res.data.file.status });
          setGroup(null);
          intentRef.current = null;
          setMsg({ kind: 'ok', text: `Grupo de ${res.data.size} celdas refinado en ${res.data.bin}.` });
          return;
        } catch (e) {
          const transient = (e instanceof ApiError && (e.status === 503 || e.status === 429)) || e instanceof TypeError;
          if (transient && attempt < 6) {
            const wait = e instanceof ApiError ? retryAfterMs(e.headers, 0) : 0;
            await sleep(wait + 500 * 2 ** attempt);
            attempt += 1;
            setMsg({ kind: 'info', text: `Reintentando (${attempt})…` });
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const d = isRecord(e.details) ? e.details : {};
        if (e.code === 'WRONG_BIN') {
          setMsg({ kind: 'err', text: `Caja incorrecta: ${bin} no corresponde a este grupo. Errores del archivo: ${String(d.mistakes ?? '?')}. Revisa las reglas y prueba otra caja.` });
          if (typeof d.mistakes === 'number') setStats((s) => ({ ...s, mistakes: d.mistakes as number }));
        } else if (e.code === 'GROUP_INVALID') {
          const reason = typeof d.reason === 'string' ? reasonText[d.reason] ?? d.reason : 'grupo inválido';
          setMsg({ kind: 'err', text: `No se puede refinar: ${reason}. Vuelve a seleccionar el grupo.` });
        } else if (e.code === 'ALREADY_REFINED') {
          const tiles = Array.isArray(d.tiles) ? (d.tiles as unknown[]).filter((t): t is [number, number] => Array.isArray(t) && t.length === 2).map((t) => [Number(t[0]), Number(t[1])] as [number, number]) : [];
          store.invalidate(tiles);
          setGroup(null);
          intentRef.current = null;
          setMsg({ kind: 'err', text: 'Alguien ya refinó parte de este grupo. Actualizamos los bloques: vuelve a seleccionarlo.' });
        } else if (e.code === 'GROUP_CLAIMED') {
          const holder = isRecord(d.holder) ? String(d.holder.displayName) : 'otro refinador';
          setMsg({ kind: 'err', text: `${holder} tiene reservado este grupo. Espera a que lo libere o elige otro.` });
        } else {
          setMsg({ kind: 'err', text: errorText(e) });
        }
      } else {
        setMsg({ kind: 'err', text: `${errorText(e)} Puedes reintentar: no se refinará dos veces.` });
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [group, canRefine, file.id, store]);

  // ---- foco y teclado ----
  const ensureVisible = useCallback((r: number, c: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = r * CELL;
    const left = c * CELL;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth;
  }, []);

  const moveFocus = useCallback((r: number, c: number) => {
    const nr2 = Math.max(0, Math.min(file.rows - 1, r));
    const nc2 = Math.max(0, Math.min(file.cols - 1, c));
    focusFromKeyboard.current = true;
    setFocus({ r: nr2, c: nc2 });
    ensureVisible(nr2, nc2);
  }, [file.rows, file.cols, ensureVisible]);

  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusFromKeyboard.current) return;
    focusFromKeyboard.current = false;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-r="${focus.r}"][data-c="${focus.c}"]`);
    el?.focus({ preventScroll: true });
  });

  const page = Math.max(1, nr - 3);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { r, c } = focus;
    switch (e.key) {
      case 'ArrowUp': moveFocus(r - 1, c); break;
      case 'ArrowDown': moveFocus(r + 1, c); break;
      case 'ArrowLeft': moveFocus(r, c - 1); break;
      case 'ArrowRight': moveFocus(r, c + 1); break;
      case 'PageUp': moveFocus(r - page, c); break;
      case 'PageDown': moveFocus(r + page, c); break;
      case 'Home': moveFocus(e.ctrlKey ? 0 : r, 0); break;
      case 'End': moveFocus(e.ctrlKey ? file.rows - 1 : r, file.cols - 1); break;
      case 'Enter': case ' ':
        if (!pendingRef.current) void selectAt(r, c);
        break;
      case 'Escape': setGroup(null); break;
      case '1': case '2': case '3': case '4':
        void refine(BINS[Number(e.key) - 1]);
        break;
      default: return;
    }
    e.preventDefault();
  };

  // ---- arrastre con Pointer Events ----
  const [drag, setDrag] = useState<{ x: number; y: number; over: Bin | null } | null>(null);
  const dragRef = useRef(false);
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!target) return;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    if (group && selectedSet.has(r * file.cols + c) && !group.noise && !group.refined && canRefine && e.button === 0) {
      e.preventDefault();
      dragRef.current = true;
      setDrag({ x: e.clientX, y: e.clientY, over: null });
      const binAt = (x: number, y: number): Bin | null => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bin]');
        const b = el?.dataset.bin;
        return b && (BINS as string[]).includes(b) ? (b as Bin) : null;
      };
      const move = (ev: PointerEvent) => setDrag({ x: ev.clientX, y: ev.clientY, over: binAt(ev.clientX, ev.clientY) });
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        dragRef.current = false;
        setDrag(null);
        const b = ev.type === 'pointerup' ? binAt(ev.clientX, ev.clientY) : null;
        if (b) void refine(b);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!target) return;
    const r = Number(target.dataset.r);
    const c = Number(target.dataset.c);
    setFocus({ r, c });
    if (group && selectedSet.has(r * file.cols + c)) return;
    void selectAt(r, c);
  };

  // ---- render ----
  const rowsOut: JSX.Element[] = [];
  const focusInRange = focus.r >= r0 && focus.r < r1 && focus.c >= c0 && focus.c < c1;
  const renderCell = (r: number, c: number) =>
    { const x = store.cell(r, c); return (
    <Cell key={c} r={r} c={c} v={x ? x.v : -1} t={x ? x.t : -1} b={x ? x.b : ''} thr={rules.tremorThreshold}
      selected={selectedSet.has(r * file.cols + c)} focused={focus.r === r && focus.c === c} />
  ); }
  for (let r = r0; r < r1; r++) {
    const cells: JSX.Element[] = [];
    for (let c = c0; c < c1; c++) cells.push(renderCell(r, c));
    if (!focusInRange && r === focus.r) cells.push(renderCell(r, focus.c));
    rowsOut.push(
      <div key={r} role="row" aria-rowindex={r + 1} style={{ position: 'absolute', top: r * CELL, left: 0, height: CELL }}>{cells}</div>,
    );
  }
  if (!focusInRange && (focus.r < r0 || focus.r >= r1)) {
    rowsOut.push(
      <div key={`f${focus.r}`} role="row" aria-rowindex={focus.r + 1} style={{ position: 'absolute', top: focus.r * CELL, left: 0, height: CELL }}>
        {renderCell(focus.r, focus.c)}
      </div>,
    );
  }

  const complete = stats.status === 'COMPLETE' || progress.overall >= 1;

  if (complete) {
    return (
      <section className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-3xl font-semibold text-teal-300">Archivo completado</h1>
        <p className="mt-3">{file.name}: {stats.refined}/{stats.total} grupos refinados · {stats.mistakes} errores.</p>
        <p className="mt-1 text-slate-300">"El trabajo es misterioso e importante."</p>
        <Link to="/files" className="mt-6 inline-block rounded bg-teal-700 px-4 py-2">Volver a los archivos</Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 p-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold">{file.name}</h1>
          <span className="text-sm text-slate-300">{file.rows}×{file.cols} · umbral {rules.tremorThreshold} · conectividad {rules.connectivity} · grupos {rules.minGroupSize}–{rules.maxGroupSize} · {rules.binning.strategy === 'DIGIT_SUM_MOD' ? 'suma % 4' : 'máximo % 4'} → [{rules.binning.order.join(', ')}]</span>
          <span className="text-sm text-slate-400">Posición {r0},{c0}</span>
        </div>
        <div ref={scrollRef} className="relative h-[calc(100vh-230px)] min-h-[300px] overflow-auto rounded border border-slate-700 bg-slate-950"
          style={{ touchAction: drag ? 'none' : 'auto' }}>
          <div
            ref={gridRef}
            role="grid"
            aria-label={`Grilla de ${file.name}`}
            aria-rowcount={file.rows}
            aria-colcount={file.cols}
            aria-busy={selecting}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onClick={onClick}
            style={{ position: 'relative', width: file.cols * CELL, height: file.rows * CELL }}
            className="font-mono text-sm select-none"
          >
            {rowsOut}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-400">Clic o Enter sobre un número que da miedo selecciona su grupo. Arrástralo a una caja o pulsa 1–4. Flechas, RePág/AvPág, Inicio/Fin para moverte.</p>
      </div>

      <aside className="w-full shrink-0 lg:w-72" aria-label="Panel de refinamiento">
        <div className="rounded border border-slate-700 p-3">
          <h2 className="font-semibold">Grupo seleccionado</h2>
          {selecting && <p role="status">Buscando el grupo completo…</p>}
          {!selecting && !group && <p className="text-sm text-slate-400">Ninguno.</p>}
          {!selecting && group && (
            <div className="text-sm" aria-live="polite">
              <p>{group.cells.length} celdas</p>
              {group.refined ? <p className="text-slate-300">Ya está refinado.</p>
                : group.noise ? <p className="text-amber-300">Es ruido: no se puede refinar.</p>
                  : <p>Caja según reglas: <strong className="text-teal-300">{group.bin}</strong></p>}
              <button className="mt-2 underline" onClick={() => setGroup(null)}>Cancelar selección</button>
            </div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {BINS.map((b, i) => {
            const enabled = !!group && !group.noise && !group.refined && !pending && canRefine;
            return (
              <button key={b} data-bin={b} disabled={!enabled}
                onClick={() => void refine(b)}
                aria-label={`Llevar el grupo a la caja ${BIN_NAME[b]} (tecla ${i + 1}). Progreso ${Math.round(progress[b] * 100)}%`}
                className={`rounded border-2 p-2 text-left ${drag?.over === b ? 'border-teal-300 bg-teal-900' : 'border-slate-600'} ${enabled ? 'hover:border-teal-400' : 'opacity-70'}`}>
                <span className="font-mono text-lg font-bold">{b}</span>
                <span className="block h-2 w-full overflow-hidden rounded bg-slate-800" aria-hidden="true">
                  <span className={`block h-full ${BIN_STYLE[BIN_CHAR[b]]}`} style={{ width: `${Math.round(progress[b] * 100)}%` }} />
                </span>
                <span className="text-xs">{Math.round(progress[b] * 100)}%</span>
              </button>
            );
          })}
        </div>
        {!canRefine && <p className="mt-2 text-sm text-amber-300">Tu rol no puede refinar (solo lectura).</p>}
        <div className="mt-3 text-sm">
          <p>Progreso total: {Math.round(progress.overall * 100)}% · {stats.refined}/{stats.total} grupos · {stats.mistakes} errores</p>
          <div className="mt-1 h-2 overflow-hidden rounded bg-slate-800" role="progressbar" aria-label="Progreso total" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.overall * 100)}>
            <div className="h-full bg-teal-500" style={{ width: `${Math.round(progress.overall * 100)}%` }} />
          </div>
        </div>
        <div aria-live="assertive" className="mt-3 min-h-6 text-sm">
          {msg && <p className={msg.kind === 'err' ? 'text-red-300' : msg.kind === 'ok' ? 'text-teal-300' : 'text-slate-300'}>{msg.text}</p>}
        </div>
        <Link to="/files" className="mt-3 inline-block text-sm text-teal-300 underline">← Archivos</Link>
      </aside>

      {drag && (
        <div aria-hidden="true" className="pointer-events-none fixed z-50 rounded bg-teal-700/90 px-2 py-1 text-sm font-semibold"
          style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {group?.cells.length} celdas{drag.over ? ` → ${drag.over}` : ''}
        </div>
      )}
    </section>
  );
}

interface CellProps {
  r: number; c: number;
  v: number; t: number; b: string;
  thr: number; selected: boolean; focused: boolean;
}

const Cell = memo(function Cell({ r, c, v, t, b, thr, selected, focused }: CellProps) {
  const cell = v < 0 ? null : { v, t, b };
  const base: CSSProperties = { position: 'absolute', left: c * CELL, top: 0, width: CELL, height: CELL };
  if (!cell) {
    return (
      <div role="gridcell" aria-colindex={c + 1} data-r={r} data-c={c} tabIndex={focused ? 0 : -1} aria-label="cargando"
        style={base} className={`grid place-items-center bg-slate-900 text-slate-700 ${focused ? 'outline-2 outline-teal-300 -outline-offset-2' : ''}`}>·</div>
    );
  }
  const scary = cell.t >= thr && cell.b === '.';
  const style: CSSProperties = scary
    ? ({ ...base, '--amp': `${(0.4 + (cell.t / 100) * 1.6).toFixed(2)}px`, '--dur': `${Math.round(700 - cell.t * 4.5)}ms` } as CSSProperties)
    : base;
  const bg = cell.b !== '.' ? BIN_STYLE[cell.b] : selected ? 'bg-teal-700' : '';
  return (
    <div role="gridcell" aria-colindex={c + 1} data-r={r} data-c={c} tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={`fila ${r + 1}, columna ${c + 1}: ${cell.v}${scary ? ', da miedo' : ''}${cell.b !== '.' ? `, refinado ${cell.b}` : ''}`}
      style={style}
      className={`grid place-items-center ${bg} ${selected ? 'ring-1 ring-teal-300 ring-inset' : ''} ${focused ? 'outline-2 outline-white -outline-offset-2' : ''} ${scary ? 'text-white' : cell.b !== '.' ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className={scary ? 'scary' : ''}>{cell.v}</span>
    </div>
  );
});
