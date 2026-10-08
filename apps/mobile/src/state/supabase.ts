// Supabase Auth for parents (phone OTP, native Google Sign-In). Only Auth is used: all data
// goes through the api function (CONTRACT §3). The parent session lives in AsyncStorage.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.ts';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || 'missing-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground (Supabase guidance for React Native).
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

export async function parentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function sendPhoneOtp(phoneE164: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
  if (error) throw error;
}

export async function verifyPhoneOtp(phoneE164: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ phone: phoneE164, token, type: 'sms' });
  if (error) throw error;
}

export async function signOutParent(): Promise<void> {
  await supabase.auth.signOut();
}
