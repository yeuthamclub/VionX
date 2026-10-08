import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from './config.ts';

/** Crash reporting is enabled only when EXPO_PUBLIC_SENTRY_DSN is set. */
export function initSentry(): void {
  if (!SENTRY_DSN) return;
  Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0.1 });
}

export { Sentry };
