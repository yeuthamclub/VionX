// Helpers for tests and acceptance scripts against local Supabase (Node). API keys are read from
// env (SUPABASE_URL, SUPABASE_ANON_KEY) or from `supabase status`; nothing is hard-coded.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export interface LocalSupabase {
  url: string;
  anonKey: string;
}

let cached: LocalSupabase | undefined;

export function localSupabase(): LocalSupabase {
  if (cached) return cached;
  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const out = spawnSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: root,
      encoding: 'utf8',
    });
    const start = out.stdout.indexOf('{');
    if (out.status !== 0 || start < 0) {
      throw new Error(`supabase status failed (is it running?): ${out.stderr || out.stdout}`);
    }
    const status = JSON.parse(out.stdout.slice(start)) as Record<string, string>;
    url ??= status.API_URL;
    anonKey ??= status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  }
  if (!url || !anonKey) throw new Error('Could not determine local Supabase URL / anon key');
  cached = { url: url.replace(/\/+$/, ''), anonKey };
  return cached;
}

async function auth(path: string, body: unknown): Promise<Record<string, unknown>> {
  const { url, anonKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`auth ${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export interface AuthSession {
  accessToken: string;
  userId: string;
}

function toSession(json: Record<string, unknown>): AuthSession {
  const user = json.user as { id: string } | undefined;
  if (typeof json.access_token !== 'string' || !user) throw new Error('no session returned');
  return { accessToken: json.access_token, userId: user.id };
}

/** Phone OTP sign-in (local test OTP numbers from supabase/config.toml). */
export async function signInWithPhoneOtp(phone: string, otp = '123456'): Promise<AuthSession> {
  await auth('otp', { phone });
  return toSession(await auth('verify', { phone, token: otp, type: 'sms' }));
}

/** Email sign-up for throwaway test parents (local only; email confirmations are off). */
export async function signUpWithEmail(email: string, password: string): Promise<AuthSession> {
  return toSession(await auth('signup', { email, password }));
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  return toSession(await auth('token?grant_type=password', { email, password }));
}
