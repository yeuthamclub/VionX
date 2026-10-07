/** Edge Functions base URL. Default: Android emulator → host machine's `supabase start`. */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:54321/functions/v1';

export const SENTRY_DSN: string | undefined = process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;
