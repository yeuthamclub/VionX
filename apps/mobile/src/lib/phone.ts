/**
 * Normalises a Vietnamese mobile number to E.164 (+84…) for Supabase phone OTP.
 * Accepts `0912 345 678`, `912345678`, `84912345678`, `+84 912-345-678`. Returns null otherwise.
 */
export function toE164Vn(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, '');
  let national: string;
  if (/^\+84\d+$/.test(digits)) national = digits.slice(3);
  else if (/^84\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  // Vietnamese mobile numbers: 9 digits after the country code, starting 3/5/7/8/9.
  return /^[35789]\d{8}$/.test(national) ? `+84${national}` : null;
}

/** `+84912345678` → `0912 345 678` for display. */
export function formatVnPhone(e164: string): string {
  const national = e164.replace(/^\+?84/, '0');
  return national.replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3');
}
