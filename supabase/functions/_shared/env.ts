// Runtime-neutral env parsing. Entry points pass `Deno.env.get`; tests pass a plain getter.

export interface FunctionEnv {
  supabaseUrl: string;
  /** URL clients reach Supabase on (signed Storage links). Defaults to SUPABASE_URL. */
  publicSupabaseUrl: string;
  dbUrl: string;
  serviceRoleKey: string;
  serviceSecret: string;
  /** Legacy HS256 JWT secret; only for projects not yet on asymmetric signing keys. */
  jwtSecret: string | undefined;
  /** JWKS of Supabase Auth; defaults to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. */
  jwksUrl: string;
  anthropicApiKey: string | undefined;
  allowedOrigins: string[];
  appVersion: string;
}

export type EnvGetter = (name: string) => string | undefined;

export function readEnv(get: EnvGetter): FunctionEnv {
  const required = (name: string): string => {
    const value = get(name)?.trim();
    if (!value) throw new Error(`Missing required env var ${name}`);
    return value;
  };
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  return {
    supabaseUrl,
    publicSupabaseUrl: (get('VIONX_PUBLIC_SUPABASE_URL')?.trim() || supabaseUrl).replace(
      /\/+$/,
      '',
    ),
    dbUrl: required('SUPABASE_DB_URL'),
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '',
    serviceSecret: required('VIONX_SERVICE_SECRET'),
    jwtSecret: get('SUPABASE_JWT_SECRET')?.trim() || undefined,
    jwksUrl: get('SUPABASE_JWKS_URL')?.trim() || `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    anthropicApiKey: get('ANTHROPIC_API_KEY')?.trim() || undefined,
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    appVersion: get('APP_VERSION')?.trim() || '0.0.0',
  };
}
