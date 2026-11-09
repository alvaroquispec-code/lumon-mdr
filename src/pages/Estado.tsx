import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api/http';
import type { Check, Clearance, ClearanceCheckResult, IntegrationStatus } from '../api/types';
import { BUILD, API_BASE } from '../config';
import { useAuth } from '../auth/AuthContext';

function Checks({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.name}>
          <span className={c.passed ? 'text-teal-300' : 'text-red-300'}>{c.passed ? '✔' : '✘'} {c.name}</span>
          <span className="text-slate-300"> — {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export default function EstadoPage() {
  const { me } = useAuth();
  const [health, setHealth] = useState<'?' | 'ok' | 'down'>('?');
  const [integ, setInteg] = useState<IntegrationStatus | null>(null);
  const [clear, setClear] = useState<Clearance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checkRes, setCheckRes] = useState<ClearanceCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [chaosBusy, setChaosBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    api('/meta/health', { auth: false, retries503: 0 }).then(() => setHealth('ok')).catch(() => setHealth('down'));
    try {
      const [i, c] = await Promise.all([api<IntegrationStatus>('/integrations/status'), api<Clearance>('/clearance')]);
      setInteg(i);
      setClear(c);
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const runCheck = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ClearanceCheckResult>('/clearance/check', { method: 'POST' });
      setCheckRes(r);
      void load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setChaos = async (level: number) => {
    setChaosBusy(true);
    setErr(null);
    try {
      await api('/workspace/chaos', { method: 'PUT', body: { level } });
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setChaosBusy(false);
    }
  };

  const card = 'rounded border border-slate-700 p-4';
  return (
    <section className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Estado</h1>
      {err && <p role="alert" className="rounded bg-red-950 p-2 text-red-200">{err}</p>}
      <div className={card}>
        <h2 className="font-semibold">Build y API</h2>
        <p className="text-sm">Build desplegado: <code>{BUILD}</code></p>
        <p className="text-sm">API: <code>{API_BASE}</code> — {health === 'ok' ? <span className="text-teal-300">responde</span> : health === 'down' ? <span className="text-red-300">no responde</span> : 'comprobando…'}</p>
        {me && <p className="text-sm">Cuadrilla: {me.team.name} ({me.team.code}) · Rol: {me.role.name}</p>}
      </div>
      <div className={card}>
        <h2 className="font-semibold">Integraciones</h2>
        {integ ? (
          <div className="text-sm">
            <p>Dominio: {integ.deploy.origin ?? 'sin verificar'} {integ.deploy.verifiedAt ? '✔' : ''}</p>
            <p>Último build visto: {integ.deploy.lastBuildSeen ?? '—'}</p>
            <p>Storage: {integ.storage.provider ?? 'sin configurar'} {integ.storage.verifiedAt ? '✔ verificado' : ''}</p>
            <Checks checks={integ.storage.checks} />
          </div>
        ) : <p className="text-sm text-slate-400">Cargando…</p>}
      </div>
      <div className={card}>
        <h2 className="font-semibold">Piso de Pruebas</h2>
        {clear && (
          <div className="text-sm">
            <p>Clearance: {clear.granted ? <span className="text-teal-300">abierto</span> : <span className="text-amber-300">cerrado</span>}</p>
            <p>Workspace: {clear.workspace.kind} · caos {clear.workspace.chaosLevel}</p>
            <p>Ronda aprobada: {clear.round.approved ? 'sí' : 'no'}{clear.round.nextRoundAt ? ` · próxima ${new Date(clear.round.nextRoundAt).toLocaleTimeString()}` : ''}</p>
            {clear.round.drawnMember && <p>Sorteado: {clear.round.drawnMember.name}</p>}
            <Checks checks={clear.checks} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => void runCheck()} disabled={busy} className="rounded bg-teal-700 px-4 py-2 font-medium hover:bg-teal-600 disabled:opacity-60">
            {busy ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
          </button>
          <span className="text-sm">Modo caos:</span>
          {[0, 1, 2].map((l) => (
            <button key={l} disabled={chaosBusy} onClick={() => void setChaos(l)}
              aria-pressed={clear?.workspace.chaosLevel === l}
              className={`rounded border px-3 py-1 text-sm ${clear?.workspace.chaosLevel === l ? 'border-teal-300 bg-teal-900' : 'border-slate-600'}`}>
              {l}
            </button>
          ))}
        </div>
        {checkRes && (
          <div className="mt-3" aria-live="polite">
            <p className="font-medium">{checkRes.granted ? 'Piso de Pruebas abierto ✔' : 'Aún no pasa la revisión'}</p>
            <Checks checks={checkRes.checks} />
          </div>
        )}
      </div>
    </section>
  );
}
