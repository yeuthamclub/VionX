import { createClient, type Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

/** Supabase Auth for admin sign-in (a parent account + ops.admin_permissions). */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
/** Publishable (anon) key: safe to ship; it grants no table access (CONTRACT §3). */
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useSession(): { session: Session | null; loading: boolean } {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({
    session: null,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}
