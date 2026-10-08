/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const SERVICE_SECRET_HEADER = 'x-vionx-service-secret';

export function hasServiceSecret(headers: Headers, expected: string): boolean {
  const provided = headers.get(SERVICE_SECRET_HEADER);
  return Boolean(expected) && provided !== null && safeEqual(provided, expected);
}
