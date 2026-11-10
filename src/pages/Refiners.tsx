import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api/http';
import { subscribeEvents } from '../events/stream';

interface Department { id: number; code: string; name: string }
interface Refiner {
  id: number; fullName: string; department: Department; title: string; extension: string; bio: string;
  profileUrl: string | null; badge: { url: string; width: number; height: number } | null; version: number; updatedAt: string;
}
interface RefinerPage { content: Refiner[]; totalElements: number; totalPages: number; page: number; size: number }

const SIZES = [10, 25, 50];

function parse(p: URLSearchParams) {
  const page = Number(p.get('page'));
  const size = Number(p.get('size'));
  const dep = Number(p.get('departmentId'));
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: SIZES.includes(size) ? size : 10,
    departmentId: Number.isInteger(dep) && dep >= 1 ? dep : 0,
    q: (p.get('q') ?? '').slice(0, 60),
  };
}
type Q = ReturnType<typeof parse>;
function toParams(q: Q): URLSearchParams {
  const p = new URLSearchParams();
  if (q.page) p.set('page', String(q.page));
  if (q.size !== 10) p.set('size', String(q.size));
  if (q.departmentId) p.set('departmentId', String(q.departmentId));
  if (q.q) p.set('q', q.q);
  return p;
}

function safeImg(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

export default function RefinersPage() {
  const [params, setParams] = useSearchParams();
  const query = parse(params);
  const key = toParams(query).toString();
  const [deps, setDeps] = useState<Department[]>([]);
  const [data, setData] = useState<RefinerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q);
  const [reload, setReload] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    api<Department[]>('/departments').then(setDeps).catch(() => setDeps([]));
  }, []);
  useEffect(() => {
    if (params.toString() !== key) setParams(toParams(query), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { setSearch(query.q); }, [query.q]);
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => setParams(toParams({ ...query, q: search.trim().slice(0, 60), page: 0 }), { replace: true }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ page: String(query.page), size: String(query.size) });
    if (query.departmentId) qs.set('departmentId', String(query.departmentId));
    if (query.q) qs.set('q', query.q);
    api<RefinerPage>(`/refiners?${qs}`, { signal: ctrl.signal })
      .then((d) => { if (id === reqId.current) setData(d); })
      .catch((e: unknown) => { if (id === reqId.current && !ctrl.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  // eventos: expediente actualizado (solo si la versión es más nueva) y reset
  useEffect(() => subscribeEvents((ev) => {
    if (ev.type === 'stream.reset') setReload((n) => n + 1);
    if (ev.type === 'refiner.updated') {
      const d = ev.data as { refiner?: Refiner } | null;
      const r = d?.refiner;
      if (!r) return;
      setData((cur) => cur && {
        ...cur,
        content: cur.content.map((x) => (x.id === r.id && r.version > x.version ? r : x)),
      });
    }
  }), []);

  const update = (patch: Partial<Q>) => setParams(toParams({ ...query, ...patch }));
  const sel = 'rounded border border-slate-600 bg-slate-900 px-2 py-1.5';

  return (
    <section className="mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-semibold">Expedientes del personal</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">Buscar
          <input type="search" className={sel} value={search} maxLength={60} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="flex flex-col text-sm">Departamento
          <select className={sel} value={query.departmentId} onChange={(e) => update({ departmentId: Number(e.target.value), page: 0 })}>
            <option value={0}>Todos</option>
            {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">Por página
          <select className={sel} value={query.size} onChange={(e) => update({ size: Number(e.target.value), page: 0 })}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {loading && <span role="status" className="text-sm text-slate-400">Cargando…</span>}
      </div>
      {error && (
        <div role="alert" className="mt-4 rounded bg-red-950 p-3 text-red-200">
          {error} <button className="ml-2 underline" onClick={() => setReload((n) => n + 1)}>Reintentar</button>
        </div>
      )}
      <ul className={`mt-4 grid gap-3 sm:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
        {data?.content.map((r) => {
          const img = r.badge ? safeImg(r.badge.url) : null;
          return (
            <li key={r.id} className="flex gap-3 rounded border border-slate-700 p-3">
              {img ? (
                <img src={img} alt={`Fotocheck de ${r.fullName}`} width={64} height={64} loading="lazy" decoding="async"
                  className="h-16 w-16 shrink-0 rounded object-cover" />
              ) : (
                <div aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded bg-slate-800 text-xl text-slate-400">
                  {r.fullName.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="font-semibold break-words">{r.fullName}</h2>
                <p className="text-sm text-slate-300 break-words">{r.title} · {r.department.name} · ext. {r.extension}</p>
                <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap break-words text-slate-400">{r.bio}</p>
                <p className="text-xs text-slate-500">v{r.version}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {data && data.content.length === 0 && !loading && <p className="mt-4 text-slate-400">No hay expedientes con estos filtros.</p>}
      {data && data.totalPages > 0 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center gap-3">
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={query.page <= 0} onClick={() => update({ page: query.page - 1 })}>Anterior</button>
          <span className="text-sm">Página {query.page + 1} de {data.totalPages} · {data.totalElements} expedientes</span>
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={query.page + 1 >= data.totalPages} onClick={() => update({ page: query.page + 1 })}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}
