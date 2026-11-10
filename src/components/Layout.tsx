import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ErrorBoundary } from './ErrorBoundary';
import { Splash } from './Guards';
import { EventsIndicator, EventsRoot } from '../events/EventsUI';

export function Layout() {
  const { me, logout, can } = useAuth();
  const loc = useLocation();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded px-3 py-1.5 ${isActive ? 'bg-teal-800 text-white' : 'text-slate-200 hover:bg-slate-800'}`;
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only-focusable bg-teal-700 p-2">Saltar al contenido</a>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <span className="font-mono font-bold tracking-widest text-teal-300">LUMON · MDR</span>
        <nav aria-label="Principal" className="flex gap-1">
          {can('files:read') && <NavLink to="/files" className={link}>Archivos</NavLink>}
          {can('refiners:read') && <NavLink to="/refiners" className={link}>Expedientes</NavLink>}
          <NavLink to="/estado" className={link}>Estado</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <EventsIndicator />
          {me && <span className="text-slate-300">{me.displayName} · {me.team.code} · {me.role.name}</span>}
          <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
      </header>
      <main id="main">
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<Splash />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <EventsRoot />
    </div>
  );
}
