/** Edge Functions base URL. Default: Android emulator → host machine's `supabase start`. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:54321/functions/v1';

/** Supabase project URL (Auth) and publishable key; the key grants no table access. */
export const SUPABASE_URL: string = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://10.0.2.2:54321';
export const SUPABASE_ANON_KEY: string = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Google OAuth "Web" client id used to request an ID token for Supabase (native sign-in). */
export const GOOGLE_WEB_CLIENT_ID: string | undefined =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;

export const SENTRY_DSN: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;
