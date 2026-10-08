// Helpers for the public account-deletion page (Google Play requirement): no admin login needed.

/**
 * Normalises a Vietnamese mobile number to E.164 (+84…) for Supabase phone OTP.
 * Same rule as the app (apps/mobile/src/lib/phone.ts).
 */
export function toE164Vn(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, '');
  let national: string;
  if (/^\+84\d+$/.test(digits)) national = digits.slice(3);
  else if (/^84\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  return /^[35789]\d{8}$/.test(national) ? `+84${national}` : null;
}

/** `2026-11-07T03:00:00Z` → `07/11/2026` in Vietnam time. */
export function formatPurgeDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export type DeletionStep =
  | { kind: 'signed-out' }
  | { kind: 'code-sent'; phone: string }
  | { kind: 'signed-in'; label: string }
  | { kind: 'scheduled'; purgeAfter: string };

/** Which account the signed-in session belongs to, for the confirmation line. */
export function accountLabel(user: { phone?: string | null; email?: string | null }): string {
  if (user.phone) return `+${user.phone.replace(/^\+/, '')}`;
  return user.email ?? '';
}
