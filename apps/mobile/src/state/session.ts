import { router } from 'expo-router';
import { childApi, parentApi } from '../api.ts';
import { unwrap } from '../lib/api-error.ts';
import { childToken, deviceMode } from './device.ts';
import { parentAccessToken } from './supabase.ts';

/** True when the parent still has to accept the current privacy policy / terms (M02). */
async function needsPolicyAcceptance(): Promise<boolean> {
  const policies = await unwrap(parentApi.GET('/api/v1/policies/current'));
  return policies.needsAcceptance === true;
}

/**
 * After a parent signs in: the onboarding consent step if the current policies are not accepted
 * yet, then the children list, otherwise create the household.
 */
export async function routeSignedInParent(): Promise<void> {
  const [me, needsAcceptance] = await Promise.all([
    unwrap(parentApi.GET('/api/v1/me')),
    needsPolicyAcceptance(),
  ]);
  await deviceMode.set('shared'); // a parent signing in on this phone leaves child-device mode
  if (needsAcceptance) router.replace('/policies');
  else router.replace(me.households.length > 0 ? '/parent' : '/household-new');
}

/**
 * Start-up route: child-device mode opens the child flow (home if the stored token is still
 * valid); otherwise a signed-in parent goes to Parent mode; everyone else sees the role chooser.
 */
export async function startRoute(): Promise<
  '/child-home' | '/child' | '/parent' | '/policies' | '/welcome'
> {
  const mode = await deviceMode.get();
  const token = await childToken.get();
  if (token) {
    try {
      await unwrap(childApi.GET('/api/v1/auth/child/session'));
      return '/child-home';
    } catch {
      // Expired, revoked or offline: fall through to the login screen (token kept if offline).
    }
  }
  if (mode === 'child') return '/child';
  if (await parentAccessToken()) {
    try {
      const [me, needsAcceptance] = await Promise.all([
        unwrap(parentApi.GET('/api/v1/me')),
        needsPolicyAcceptance(),
      ]);
      if (me.households.length > 0 && needsAcceptance) return '/policies';
      return me.households.length > 0 ? '/parent' : '/welcome';
    } catch {
      return '/welcome';
    }
  }
  return '/welcome';
}
