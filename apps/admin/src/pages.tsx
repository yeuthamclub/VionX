import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { HealthResponse } from '@vionx/contracts/client';
import { api, API_BASE_URL } from './api.ts';
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
  return (
    <main className="login">
      <div className="card">
        <h1>VionX Admin</h1>
        <p className="muted">
          Admin sign-in (parent account + admin permissions) arrives with M01. This placeholder only
          opens the navigation shell.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({ to: '/' });
          }}
        >
          <label>
            Email
            <input type="email" disabled placeholder="admin@example.com" />
          </label>
          <button type="submit">Continue (development)</button>
        </form>
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <section>
      <h1>Not found</h1>
      <Link to="/">Back to dashboard</Link>
    </section>
  );
}
