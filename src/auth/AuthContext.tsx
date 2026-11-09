import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/http';
import type { LoginResponse, Me, Permission } from '../api/types';
import { logoutServer, onSessionEnd, restore, startSession } from './session';

type Status = 'loading' | 'anon' | 'authed';
interface AuthValue {
  status: Status;
  me: Me | null;
  notice: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (teamName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
  can: (p: Permission) => boolean;
  clearNotice: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

const REASONS: Record<string, string> = {
  REFRESH_REUSED: 'Tu sesión se cerró por seguridad: se detectó un token reutilizado. Vuelve a iniciar sesión.',
  SESSION_REVOKED: 'Tu sesión fue revocada. Vuelve a iniciar sesión.',
  TOKEN_INVALID: 'Tu sesión ya no es válida. Vuelve a iniciar sesión.',
  REFRESH_INVALID: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  LOGOUT: 'Se cerró la sesión.',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadMe = useCallback(async () => {
    const m = await api<Me>('/auth/me');
    setMe(m);
    setStatus('authed');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await restore();
        if (!alive) return;
        if (ok) await reloadMe();
        else setStatus('anon');
      } catch {
        if (alive) setStatus('anon');
      }
    })();
    const off = onSessionEnd((reason) => {
      setMe(null);
      setStatus('anon');
      setNotice(reason ? REASONS[reason] ?? 'La sesión terminó.' : null);
    });
    return () => { alive = false; off(); };
  }, [reloadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    startSession(r);
    setNotice(null);
    await reloadMe();
  }, [reloadMe]);

  const register = useCallback(async (teamName: string, email: string, password: string) => {
    const r = await api<LoginResponse>('/auth/register', { method: 'POST', body: { teamName, email, password }, auth: false });
    startSession(r);
    setNotice(null);
    await reloadMe();
  }, [reloadMe]);

  const logout = useCallback(async () => {
    await logoutServer();
  }, []);

  const value = useMemo<AuthValue>(() => ({
    status, me, notice, login, register, logout, reloadMe,
    can: (p) => !!me?.permissions.includes(p),
    clearNotice: () => setNotice(null),
  }), [status, me, notice, login, register, logout, reloadMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
