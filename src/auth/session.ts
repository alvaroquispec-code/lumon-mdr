import { ApiError, api, setTokenProvider } from '../api/http';
import type { LoginResponse, TokenPair } from '../api/types';

const RT_KEY = 'lumon.rt';
type Msg =
  | { type: 'access'; token: string }
  | { type: 'need-access' }
  | { type: 'logout'; reason: string | null };

let access: string | null = null;
let inflight: Promise<string> | null = null;
const listeners = new Set<(reason: string | null) => void>();
const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-auth') : null;

function readRt(): string | null {
  try { return localStorage.getItem(RT_KEY); } catch { return null; }
}
function writeRt(v: string | null): void {
  try {
    if (v) localStorage.setItem(RT_KEY, v);
    else localStorage.removeItem(RT_KEY);
  } catch { /* storage no disponible */ }
}

function endLocal(reason: string | null): void {
  access = null;
  writeRt(null);
  listeners.forEach((l) => l(reason));
}

export function onSessionEnd(fn: (reason: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

bc?.addEventListener('message', (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'access') access = m.token;
  else if (m.type === 'need-access' && access) bc.postMessage({ type: 'access', token: access } satisfies Msg);
  else if (m.type === 'logout') { access = null; listeners.forEach((l) => l(m.reason)); }
});
window.addEventListener('storage', (e) => {
  if (e.key === RT_KEY && e.newValue === null && access) {
    access = null;
    listeners.forEach((l) => l(null));
  }
});

export function revoke(reason: string | null): void {
  endLocal(reason);
  bc?.postMessage({ type: 'logout', reason } satisfies Msg);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('lumon-refresh', fn);
  }
  return fn();
}

export function refreshShared(failed: string | null): Promise<string> {
  if (access && access !== failed) return Promise.resolve(access);
  if (inflight) return inflight;
  inflight = withLock(async () => {
    if (access && access !== failed) return access;
    const rt = readRt();
    if (!rt) throw new ApiError(401, 'SESSION_REVOKED', 'No hay sesión.', null, null);
    try {
      const pair = await api<TokenPair>('/auth/refresh', { method: 'POST', body: { refreshToken: rt }, auth: false });
      writeRt(pair.refreshToken);
      access = pair.accessToken;
      bc?.postMessage({ type: 'access', token: access } satisfies Msg);
      return access;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) revoke(e.code);
      throw e;
    }
  }).finally(() => { inflight = null; });
  return inflight;
}

setTokenProvider({
  getAccess: () => access,
  refresh: refreshShared,
  onRevoked: (code) => revoke(code),
});

/** Intenta obtener el access token de otra pestaña antes de gastar un refresh. */
function askOtherTabs(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!bc) return resolve(null);
    const h = (ev: MessageEvent<Msg>) => {
      if (ev.data.type === 'access') { bc.removeEventListener('message', h); resolve(ev.data.token); }
    };
    bc.addEventListener('message', h);
    bc.postMessage({ type: 'need-access' } satisfies Msg);
    setTimeout(() => { bc.removeEventListener('message', h); resolve(null); }, 350);
  });
}

export async function restore(): Promise<boolean> {
  if (!readRt()) return false;
  const t = await askOtherTabs();
  if (t) { access = t; return true; }
  await refreshShared(null);
  return true;
}

export function startSession(r: LoginResponse | TokenPair): void {
  access = r.accessToken;
  writeRt(r.refreshToken);
}

export async function logoutServer(): Promise<void> {
  const rt = readRt();
  try {
    if (rt) await api<null>('/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false });
  } finally {
    revoke(null);
  }
}
