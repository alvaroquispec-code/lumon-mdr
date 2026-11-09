import { API_BASE, BUILD } from '../config';

export interface ErrorBody {
  error: string;
  message: string;
  details: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly headers: Headers | null;
  constructor(status: number, code: string, message: string, details: unknown, headers: Headers | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function retryAfterMs(h: Headers | null, fallback: number): number {
  const v = h?.get('Retry-After');
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n * 1000 : fallback;
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/* ---------- token store (memory only) ---------- */
type TokenProvider = {
  getAccess: () => string | null;
  refresh: (failedToken: string | null) => Promise<string>;
  onRevoked: (code: string) => void;
};
let provider: TokenProvider | null = null;
export function setTokenProvider(p: TokenProvider): void {
  provider = p;
}

export interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  auth?: boolean;
  /** reintentos automáticos de 503 */
  retries503?: number;
}

export interface RawResponse<T> { data: T; headers: Headers; status: number }

async function doFetch(path: string, opts: RequestOpts, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'X-Lumon-Build': BUILD, ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: 'no-store',
  });
}

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo */
  }
  if (isRecord(body) && typeof body.error === 'string') {
    return new ApiError(res.status, body.error, String(body.message ?? ''), body.details ?? null, res.headers);
  }
  return new ApiError(res.status, `HTTP_${res.status}`, res.statusText || 'Error', null, res.headers);
}

export async function requestRaw<T>(path: string, opts: RequestOpts = {}): Promise<RawResponse<T>> {
  const useAuth = opts.auth !== false;
  let token = useAuth ? provider?.getAccess() ?? null : null;
  let refreshed = false;
  let attempt503 = 0;
  const max503 = opts.retries503 ?? 3;
  for (;;) {
    const res = await doFetch(path, opts, token);
    if (res.ok) {
      let data: unknown = null;
      if (res.status !== 204) {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      }
      return { data: data as T, headers: res.headers, status: res.status };
    }
    const err = await toError(res);
    if (useAuth && err.status === 401 && err.code === 'TOKEN_EXPIRED' && !refreshed && provider) {
      refreshed = true;
      token = await provider.refresh(token);
      continue;
    }
    if (useAuth && err.status === 401 && (err.code === 'SESSION_REVOKED' || err.code === 'TOKEN_INVALID' || err.code === 'REFRESH_REUSED')) {
      provider?.onRevoked(err.code);
    }
    if (err.status === 503 && attempt503 < max503) {
      const wait = retryAfterMs(err.headers, 500 * 2 ** attempt503);
      attempt503 += 1;
      await sleep(wait + Math.random() * 200, opts.signal);
      continue;
    }
    throw err;
  }
}

export async function api<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  return (await requestRaw<T>(path, opts)).data;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'FORBIDDEN': return 'No tienes permiso para esta acción.';
      case 'RATE_LIMITED': return 'Demasiadas solicitudes. Espera un momento.';
      case 'SERVICE_UNAVAILABLE': return 'Lumon no está disponible ahora. Intenta de nuevo.';
      case 'CLEARANCE_REQUIRED': return 'El Piso de Pruebas aún no está abierto.';
      default: return e.message || e.code;
    }
  }
  if (e instanceof DOMException && e.name === 'AbortError') return 'Cancelado.';
  if (e instanceof TypeError) return 'No se pudo conectar con Lumon. Revisa tu conexión.';
  return e instanceof Error ? e.message : 'Error desconocido';
}
