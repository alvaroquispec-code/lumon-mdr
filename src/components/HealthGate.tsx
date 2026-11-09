import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/http';

export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nextIn, setNextIn] = useState(0);
  const timer = useRef<number | null>(null);

  const check = useCallback(async (n: number) => {
    if (timer.current) window.clearInterval(timer.current);
    try {
      await api('/meta/health', { auth: false, retries503: 0 });
      setOk(true);
    } catch {
      setOk(false);
      const wait = Math.min(30, 2 ** n);
      setNextIn(wait);
      let left = wait;
      timer.current = window.setInterval(() => {
        left -= 1;
        setNextIn(left);
        if (left <= 0) {
          if (timer.current) window.clearInterval(timer.current);
          setAttempt((a) => a + 1);
        }
      }, 1000);
    }
  }, []);

  useEffect(() => { void check(attempt); }, [attempt, check]);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  if (ok) return <>{children}</>;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center" role="status" aria-live="polite">
        <h1 className="text-xl font-semibold">Conectando con Lumon…</h1>
        {ok === false && (
          <>
            <p className="mt-2 text-slate-300">No hay respuesta del servidor. Reintento automático en {nextIn} s (intento {attempt + 1}).</p>
            <button className="mt-4 rounded bg-teal-700 px-4 py-2 font-medium hover:bg-teal-600" onClick={() => setAttempt((a) => a + 1)}>
              Reintentar ahora
            </button>
          </>
        )}
      </div>
    </main>
  );
}
