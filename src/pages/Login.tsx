import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errorText, isRecord } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { Splash } from '../components/Guards';

function safeFrom(v: string | null): string {
  if (!v || !v.startsWith('/') || v.startsWith('//')) return '/files';
  if (v.startsWith('/login') || v.startsWith('/register')) return '/files';
  return v;
}

function fieldErrors(e: unknown): Record<string, string> {
  if (e instanceof ApiError && isRecord(e.details) && isRecord(e.details.fields)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.details.fields)) out[k] = String(v);
    return out;
  }
  return {};
}

const input = 'mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 focus:outline-2 focus:outline-teal-400';

export function LoginPage({ mode }: { mode: 'login' | 'register' }) {
  const { status, login, register, notice } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const from = safeFrom(params.get('from'));
  const [teamName, setTeamName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  if (status === 'loading') return <Splash />;
  if (status === 'authed') return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      if (mode === 'login') await login(email, password);
      else await register(teamName, email, password);
      nav(from, { replace: true });
    } catch (err) {
      const f = fieldErrors(err);
      if (err instanceof ApiError && err.status === 409) {
        const msg = err.message || 'Ya registrado.';
        if (/nombre|team/i.test(msg) || err.code.includes('TEAM')) f.teamName = msg;
        else f.email = msg;
      }
      setFields(f);
      if (Object.keys(f).length === 0) {
        setError(err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? 'Email o contraseña incorrectos.' : errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (k: string) =>
    fields[k] ? <p id={`${k}-err`} className="mt-1 text-sm text-red-300">{fields[k]}</p> : null;

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900/60 p-6" noValidate>
        <h1 className="text-2xl font-semibold">{mode === 'login' ? 'Entrar al piso' : 'Registrar cuadrilla'}</h1>
        {notice && <p role="alert" className="mt-3 rounded bg-amber-900/50 p-2 text-sm text-amber-100">{notice}</p>}
        {mode === 'register' && (
          <label className="mt-4 block">
            <span>Nombre de la cuadrilla</span>
            <input className={input} value={teamName} onChange={(e) => setTeamName(e.target.value)} required minLength={3} maxLength={40}
              aria-invalid={!!fields.teamName} aria-describedby={fields.teamName ? 'teamName-err' : undefined} />
            {fieldErr('teamName')}
          </label>
        )}
        <label className="mt-4 block">
          <span>Email</span>
          <input className={input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            aria-invalid={!!fields.email} aria-describedby={fields.email ? 'email-err' : undefined} />
          {fieldErr('email')}
        </label>
        <label className="mt-4 block">
          <span>Contraseña</span>
          <input className={input} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} required
            aria-invalid={!!fields.password} aria-describedby={fields.password ? 'password-err' : undefined} />
          {fieldErr('password')}
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded bg-teal-700 py-2 font-medium hover:bg-teal-600 disabled:opacity-60">
          {busy ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Registrar'}
        </button>
        <p className="mt-4 text-center text-sm text-slate-300">
          {mode === 'login'
            ? <Link className="text-teal-300 underline" to={`/register${params.toString() ? `?${params}` : ''}`}>Registrar una cuadrilla</Link>
            : <Link className="text-teal-300 underline" to={`/login${params.toString() ? `?${params}` : ''}`}>Ya tengo cuenta</Link>}
        </p>
      </form>
    </main>
  );
}
