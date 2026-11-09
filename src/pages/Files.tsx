import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api/http';
import type { FilePage } from '../api/types';

const SIZES = [10, 25, 50] as const;
const SORTS = [
  { v: 'updatedAt,desc', l: 'Más recientes' },
  { v: 'progress,desc', l: 'Mayor progreso' },
  { v: 'name,asc', l: 'Nombre (A-Z)' },
] as const;
const STATUSES = ['', 'ACTIVE', 'COMPLETE'] as const;

interface Query { page: number; size: number; status: string; q: string; sort: string }

function parse(p: URLSearchParams): Query {
  const page = Number(p.get('page'));
  const size = Number(p.get('size'));
  const status = p.get('status') ?? '';
  const sort = p.get('sort') ?? '';
  const q = (p.get('q') ?? '').slice(0, 60);
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: (SIZES as readonly number[]).includes(size) ? size : 10,
    status: (STATUSES as readonly string[]).includes(status) ? status : '',
    sort: SORTS.some((s) => s.v === sort) ? sort : 'updatedAt,desc',
    q,
  };
}

function toParams(q: Query): URLSearchParams {
  const p = new URLSearchParams();
  if (q.page) p.set('page', String(q.page));
  if (q.size !== 10) p.set('size', String(q.size));
  if (q.status) p.set('status', q.status);
  if (q.q) p.set('q', q.q);
  if (q.sort !== 'updatedAt,desc') p.set('sort', q.sort);
  return p;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function FilesPage() {
  const [params, setParams] = useSearchParams();
  const query = parse(params);
  const key = toParams(query).toString();
  const [data, setData] = useState<FilePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q);
  const [reload, setReload] = useState(0);
  const reqId = useRef(0);

  // normaliza URL inválida
  useEffect(() => {
    if (params.toString() !== key) setParams(toParams(query), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // sincroniza input si cambia la URL (atrás/adelante)
  useEffect(() => { setSearch(query.q); }, [query.q]);

  // debounce de búsqueda
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => {
      setParams(toParams({ ...query, q: search.trim().slice(0, 60), page: 0 }), { replace: true });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ page: String(query.page), size: String(query.size), sort: query.sort });
    if (query.status) qs.set('status', query.status);
    if (query.q) qs.set('q', query.q);
    api<FilePage>(`/files?${qs}`, { signal: ctrl.signal })
      .then((d) => {
        if (id !== reqId.current) return;
        setData(d);
        if (d.totalPages > 0 && query.page >= d.totalPages) {
          setParams(toParams({ ...query, page: d.totalPages - 1 }), { replace: true });
        }
      })
      .catch((e: unknown) => {
        if (id !== reqId.current || ctrl.signal.aborted) return;
        setError(errorText(e));
      })
      .finally(() => { if (id === reqId.current) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  const update = (patch: Partial<Query>) => setParams(toParams({ ...query, ...patch }));
  const sel = 'rounded border border-slate-600 bg-slate-900 px-2 py-1.5';

  return (
    <section className="mx-auto max-w-5xl p-4">
      <h1 className="text-2xl font-semibold">Archivos de datos</h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">Buscar
          <input type="search" className={sel} value={search} onChange={(e) => setSearch(e.target.value)} maxLength={60} placeholder="Nombre del archivo" />
        </label>
        <label className="flex flex-col text-sm">Estado
          <select className={sel} value={query.status} onChange={(e) => update({ status: e.target.value, page: 0 })}>
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="COMPLETE">Completados</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">Orden
          <select className={sel} value={query.sort} onChange={(e) => update({ sort: e.target.value, page: 0 })}>
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
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

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Listado de archivos</caption>
          <thead className="border-b border-slate-700 text-slate-300">
            <tr><th className="py-2">Nombre</th><th>Tamaño</th><th>Estado</th><th>Progreso</th><th>Grupos</th><th>Errores</th><th><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody className={loading ? 'opacity-60' : ''}>
            {data?.content.map((f) => (
              <tr key={f.id} className="border-b border-slate-800">
                <td className="py-2 font-medium">{f.name}</td>
                <td>{f.rows} × {f.cols}</td>
                <td>{f.status === 'COMPLETE' ? 'Completado' : 'Activo'}</td>
                <td>{pct(f.progress.overall)}</td>
                <td>{f.refinedGroups}/{f.totalGroups}</td>
                <td>{f.mistakes}</td>
                <td><Link className="text-teal-300 underline" to={`/files/${f.id}/refine`}>Refinar<span className="sr-only"> {f.name}</span></Link></td>
              </tr>
            ))}
            {data && data.content.length === 0 && !loading && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-400">No hay archivos con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.totalPages > 0 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center gap-3">
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={query.page <= 0} onClick={() => update({ page: query.page - 1 })}>Anterior</button>
          <span className="text-sm">Página {query.page + 1} de {data.totalPages} · {data.totalElements} archivos</span>
          <button className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40" disabled={query.page + 1 >= data.totalPages} onClick={() => update({ page: query.page + 1 })}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}
