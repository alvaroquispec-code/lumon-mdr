import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { startEvents, subscribeEvents, subscribeStatus, type StreamStatus } from './stream';

const LABEL: Record<StreamStatus, string> = {
  idle: 'sin conectar',
  connecting: 'conectando…',
  open: 'en vivo',
  reconnecting: 'reconectando…',
  'closed-floor': 'piso cerrado',
  follower: 'compartido',
};

export function EventsIndicator() {
  const [s, setS] = useState<StreamStatus>('idle');
  useEffect(() => subscribeStatus(setS), []);
  const color = s === 'open' ? 'bg-teal-400' : s === 'reconnecting' || s === 'connecting' ? 'bg-amber-400' : 'bg-slate-500';
  return (
    <span className="flex items-center gap-1 text-xs text-slate-300" role="status" aria-live="polite">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      Eventos: {LABEL[s]}
    </span>
  );
}

interface Contingency { id: string | number; userId: number; message?: string }

export function EventsRoot() {
  const { me } = useAuth();
  const [cont, setCont] = useState<Contingency | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!me) return;
    const stop = startEvents();
    const off = subscribeEvents((ev) => {
      const d = ev.data as Record<string, unknown> | null;
      if (ev.type === 'contingency.activated' && d && d.userId === me.id) {
        setCont({ id: d.id as string | number, userId: me.id, message: typeof d.message === 'string' ? d.message : undefined });
        setErr(null);
      }
      if (ev.type === 'contingency.resolved' && d) {
        setCont((c) => (c && String(c.id) === String(d.id) ? null : c));
      }
    });
    return () => { off(); stop(); };
  }, [me]);

  useEffect(() => {
    if (cont) btnRef.current?.focus();
  }, [cont]);

  if (!cont) return null;

  const ack = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/contingency/${encodeURIComponent(String(cont.id))}/ack`, { method: 'POST' });
      setCont(null);
    } catch (e) {
      setErr(`No se pudo confirmar: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const trap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    const els = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
    if (!els || els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4">
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="cont-title" aria-describedby="cont-desc"
        onKeyDown={trap} className="w-full max-w-md rounded-lg border-2 border-amber-400 bg-slate-900 p-6">
        <h2 id="cont-title" className="text-xl font-bold text-amber-300">Contingencia de horas extra</h2>
        <p id="cont-desc" className="mt-2" aria-live="assertive">{cont.message ?? 'Se activó una contingencia para ti. Confírmala para continuar.'}</p>
        {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
        <button ref={btnRef} disabled={busy} onClick={() => void ack()}
          className="mt-4 w-full rounded bg-amber-600 py-2 font-semibold text-black hover:bg-amber-500 disabled:opacity-60">
          {busy ? 'Confirmando…' : 'Confirmar contingencia'}
        </button>
      </div>
    </div>
  );
}
