// Native Google Sign-In → Supabase `signInWithIdToken`. Needs a development build with the
// @react-native-google-signin config plugin, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, an Android OAuth
// client for the app's SHA-1, and the Google provider enabled in Supabase Auth (README).
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GOOGLE_WEB_CLIENT_ID } from '../config.ts';
import { supabase } from './supabase.ts';

export const googleSignInAvailable = Boolean(GOOGLE_WEB_CLIENT_ID);

let configured = false;

/** Returns false when the parent cancelled; throws on configuration or network errors. */
export async function signInWithGoogle(): Promise<boolean> {
  if (!GOOGLE_WEB_CLIENT_ID) throw new Error('Google sign-in is not configured');
  if (!configured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, scopes: ['email', 'profile'] });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return false;
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google did not return an ID token');
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
    return true;
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.IN_PROGRESS) return false;
    throw error;
  }
}

export async function signOutGoogle(): Promise<void> {
  if (configured) await GoogleSignin.signOut().catch(() => {});
}
