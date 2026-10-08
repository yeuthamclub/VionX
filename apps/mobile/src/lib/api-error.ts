import type { ApiErrorBody } from '@vionx/contracts/client';
import { t, type MessageKey } from '../i18n/index.ts';

/** The parent's account deletion is pending: only the Privacy Center (cancel) is reachable. */
export function isAccountDeletionPending(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === 'ACCOUNT_DISABLED' &&
    (error.body?.details as { reason?: unknown } | undefined)?.reason === 'DELETION_PENDING'
  );
}

/** Thrown by `unwrap` for non-2xx responses; `offline` for network failures. */
export class AppError extends Error {
  constructor(
    readonly kind: 'api' | 'offline',
    readonly status: number,
    readonly body?: ApiErrorBody,
  ) {
    super(body?.message ?? (kind === 'offline' ? 'offline' : `HTTP ${status}`));
  }
  get code(): string | undefined {
    return this.body?.code;
  }
}

/** Unwraps an openapi-fetch result: returns data or throws AppError. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    throw new AppError('offline', 0);
  }
  if (result.response.ok && result.data !== undefined) return result.data;
  const body = result.error as ApiErrorBody | undefined;
  throw new AppError('api', result.response.status, body && 'code' in body ? body : undefined);
}

const CODE_MESSAGES: Partial<Record<string, MessageKey>> = {
  UNAUTHENTICATED: 'error.unauthenticated',
  NOT_FOUND: 'error.notFound',
  CONFLICT: 'error.conflict',
  VALIDATION_FAILED: 'error.validation',
  RATE_LIMITED: 'error.rateLimited',
  ACCOUNT_DISABLED: 'error.childDisabled',
};

/** A user-facing Vietnamese (or English) sentence for any error, with lock/attempt details. */
export function describeError(error: unknown, now: Date = new Date()): string {
  if (!(error instanceof AppError)) return t('error.generic');
  if (error.kind === 'offline') return t('error.offline');
  const details = (error.body?.details ?? {}) as Record<string, unknown>;
  switch (error.code) {
    case 'INVALID_CREDENTIALS': {
      const left = details.attemptsRemaining;
      return typeof left === 'number'
        ? t('error.wrongPinLeft', { n: left })
        : t('error.wrongCredentials');
    }
    case 'ACCOUNT_LOCKED': {
      const until = typeof details.lockedUntil === 'string' ? Date.parse(details.lockedUntil) : NaN;
      const minutes = Number.isNaN(until)
        ? 15
        : Math.max(1, Math.ceil((until - now.getTime()) / 60_000));
      return t('error.locked', { n: minutes });
    }
    case 'ACCOUNT_DISABLED':
      return details.reason === 'DELETION_PENDING'
        ? t('error.accountDeletionPending')
        : t('error.childDisabled');
    case 'CONSENT_REQUIRED':
      return details.consentType === 'CORE_SERVICE'
        ? t('error.consentRequired')
        : t('error.featureConsent');
    default: {
      const key = error.code ? CODE_MESSAGES[error.code] : undefined;
      return key ? t(key) : t('error.generic');
    }
  }
}
