import type { ConsentState, ConsentType } from '@vionx/contracts/client';
import type { MessageKey } from '../i18n/index.ts';

/** Status line of a consent row. */
export function consentStateKey(state: ConsentState): MessageKey {
  if (state.effective) return 'consent.state.on';
  switch (state.reason) {
    case 'CHILD_ASSENT_PENDING':
      return 'consent.state.assentPending';
    case 'CHILD_ASSENT_DECLINED':
      return 'consent.state.assentDeclined';
    case 'RECONSENT_REQUIRED':
      return 'consent.state.reconsent';
    default:
      return 'consent.state.off';
  }
}

/**
 * Whether the parent's grant is active (the row offers "Turn off"). A grant on an outdated policy
 * version offers "Turn on" again so the parent re-consents.
 */
export function isGrantActive(state: ConsentState): boolean {
  return state.record?.status === 'GRANTED' && state.reason !== 'RECONSENT_REQUIRED';
}

/** Consents waiting for the child's answer (child assent screen). */
export function pendingAssents(consents: readonly ConsentState[]): ConsentType[] {
  return consents
    .filter((c) => c.record?.status === 'GRANTED' && c.record.childAssentStatus === 'PENDING')
    .map((c) => c.type);
}

export const consentTitleKey = (type: ConsentType) => `consent.${type}.title` as MessageKey;
export const consentBodyKey = (type: ConsentType) => `consent.${type}.body` as MessageKey;

/** `2026-11-07T03:00:00Z` → `07/11/2026` (Vietnam time). */
export function formatDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000); // Asia/Ho_Chi_Minh, no DST
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** `… 14:05 07/11/2026` for export expiry. */
export function formatDayTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${formatDay(iso)}`;
}
