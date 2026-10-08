/** Source of cryptographically secure random bytes (callers pass `crypto.getRandomValues`-backed). */
export type RandomBytes = (length: number) => Uint8Array;

/**
 * Picks `count` characters from `alphabet` without modulo bias (rejection sampling).
 * The domain stays pure: the caller supplies the random source.
 */
export function randomString(alphabet: string, count: number, random: RandomBytes): string {
  if (alphabet.length < 2 || alphabet.length > 256) throw new RangeError('alphabet size 2..256');
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < count) {
    for (const byte of random(count * 2)) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
      if (out.length === count) break;
    }
  }
  return out;
}
