// PIN hashing (argon2id via hash-wasm: WebAssembly, runs in the Deno Edge Runtime and in Node)
// and opaque child-session tokens (32 random bytes, stored as sha-256).
import { argon2id, argon2Verify } from 'hash-wasm';
import { CHILD_TOKEN_BYTES } from '@vionx/domain';

/** OWASP argon2id baseline: 19 MiB, 2 iterations, 1 lane. ~80 ms per hash. */
export const ARGON2_PARAMS = { memorySize: 19_456, iterations: 2, parallelism: 1, hashLength: 32 };

export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));

export async function hashPin(pin: string): Promise<string> {
  return argon2id({
    password: pin,
    salt: randomBytes(16),
    ...ARGON2_PARAMS,
    outputType: 'encoded',
  });
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: pin, hash: encoded });
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Burns the same work as a real check so unknown login ids are not distinguishable by timing. */
export async function verifyAgainstDummy(pin: string): Promise<false> {
  dummyHash ??= hashPin('000000');
  await verifyPin(pin, await dummyHash);
  return false;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** New opaque child token (43 base64url chars) and the hash stored in app.child_sessions. */
export async function newChildToken(): Promise<{ token: string; tokenHash: string }> {
  const token = base64url(randomBytes(CHILD_TOKEN_BYTES));
  return { token, tokenHash: await sha256Hex(token) };
}
