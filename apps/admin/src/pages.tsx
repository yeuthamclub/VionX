import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import type { HealthResponse } from '@vionx/contracts/client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { adminAccess, type AdminAccess } from './access.ts';
import { api, API_BASE_URL, fetchMe } from './api.ts';
import { supabase, useSession } from './auth.ts';
import type { NavLeaf } from './nav.ts';

async function fetchHealth(): Promise<HealthResponse> {
  // 503 still carries a HealthResponse body describing what is down.
  const { data, error, response } = await api.GET('/api/v1/health');
  const body = data ?? (error as HealthResponse | undefined);
  if (!body || !('checks' in body)) throw new Error(`API responded ${response.status}`);
  return body;
}

export function DashboardPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });

  return (
    <section>
      <h1>Dashboard</h1>
      <div className="card">
        <h2>API health</h2>
        <p className="muted">{API_BASE_URL}/api/v1/health</p>
        {health.isPending && <p>Checking…</p>}
        {health.isError && (
          <p className="error">
            Cannot reach the API: {health.error.message}.{' '}
            <button onClick={() => void health.refetch()}>Retry</button>
          </p>
        )}
        {health.data && (
          <>
            <p>
              Status:{' '}
              <strong className={health.data.status === 'ok' ? 'ok' : 'error'}>
                {health.data.status.toUpperCase()}
              </strong>{' '}
              <span className="muted">version {health.data.version}</span>
            </p>
            <table>
              <tbody>
                {Object.entries(health.data.checks).map(([name, check]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className={check.ok ? 'ok' : check.critical ? 'error' : 'warn'}>
                      {check.ok ? 'OK' : check.critical ? 'FAIL' : 'WARN'}
                    </td>
                    <td className="muted">{check.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

export function StubPage({ leaf }: { leaf: NavLeaf }) {
  return (
    <section>
      <h1>{leaf.label}</h1>
      <div className="card empty">
        <p>This screen arrives with {leaf.module}.</p>
      </div>
    </section>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'busy' });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setStatus({ kind: 'error', message: error.message });
    try {
      const access = adminAccess(await fetchMe());
      if (access.kind !== 'granted') {
        await supabase.auth.signOut();
        return setStatus({ kind: 'error', message: 'This account has no admin permission.' });
      }
      void navigate({ to: '/' });
    } catch (err) {
      setStatus({ kind: 'error', message: `Cannot reach the API: ${(err as Error).message}` });
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setStatus({ kind: 'error', message: error.message });
  }

  return (
    <main className="login">
      <div className="card">
        <h1>VionX Admin</h1>
        <p className="muted">
          Sign in with a VionX account that has admin permissions (Supabase Auth). Locally the
          seeded SUPER_ADMIN is <code>admin@vionx.local</code>.
        </p>
        <form onSubmit={(e) => void signIn(e)}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={status.kind === 'busy'}>
            {status.kind === 'busy' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <button type="button" className="secondary" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
        {status.kind === 'error' && (
          <p className="error" role="alert">
            {status.message}
          </p>
        )}
      </div>
    </main>
  );
}

/** Guards the admin shell: needs a session and at least one admin permission. */
export function AdminGate({
  children,
}: {
  children: (access: Extract<AdminAccess, { kind: 'granted' }>) => ReactNode;
}) {
  const { session, loading } = useSession();
  const me = useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: fetchMe,
    enabled: Boolean(session),
    retry: false,
  });

  if (loading || (session && me.isPending)) {
    return <main className="login muted">Loading…</main>;
  }
  if (!session) return <Navigate to="/login" />;
  if (me.isError) {
    return (
      <main className="login">
        <div className="card">
          <p className="error">Cannot reach the API: {me.error.message}</p>
          <button onClick={() => void me.refetch()}>Retry</button>
        </div>
      </main>
    );
  }
  const access = adminAccess(me.data ?? null);
  if (access.kind === 'signed-out') return <Navigate to="/login" />;
  if (access.kind === 'denied') {
    return (
      <main className="login">
        <div className="card">
          <h1>No admin access</h1>
          <p className="muted">{access.userLabel} has no admin permission.</p>
          <button onClick={() => void supabase.auth.signOut()}>Sign out</button>
        </div>
      </main>
    );
  }
  return <>{children(access)}</>;
}

export function NotFoundPage() {
  return (
    <section>
      <h1>Not found</h1>
      <Link to="/">Back to dashboard</Link>
    </section>
  );
}
