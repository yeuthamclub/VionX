// Runtime-neutral env parsing. Entry points pass `Deno.env.get`; tests pass a plain getter.

export interface FunctionEnv {
  supabaseUrl: string;
  dbUrl: string;
  serviceRoleKey: string;
  serviceSecret: string;
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
  return {
    supabaseUrl: required('SUPABASE_URL'),
    dbUrl: required('SUPABASE_DB_URL'),
    serviceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '',
    serviceSecret: required('VIONX_SERVICE_SECRET'),
    anthropicApiKey: get('ANTHROPIC_API_KEY')?.trim() || undefined,
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    appVersion: get('APP_VERSION')?.trim() || '0.0.0',
  };
}
