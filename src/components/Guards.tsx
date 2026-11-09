import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Permission } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function Splash() {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
      <p className="text-slate-300">Verificando sesión…</p>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') {
    const from = loc.pathname + loc.search + loc.hash;
    return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
  }
  return <>{children}</>;
}

export function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <NoPermission perm={perm} />;
  return <>{children}</>;
}

export function NoPermission({ perm }: { perm?: string }) {
  return (
    <section className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-2xl font-semibold">Sin permiso</h1>
      <p className="mt-2 text-slate-300">Tu rol no tiene acceso a esta sección{perm ? ` (requiere ${perm})` : ''}.</p>
      <a className="mt-4 inline-block text-teal-300 underline" href="/files">Volver a los archivos</a>
    </section>
  );
}
