// Verifies Supabase Auth access tokens (parents). Asymmetric keys come from the project JWKS;
// a legacy HS256 secret is accepted only when SUPABASE_JWT_SECRET is configured.
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export interface ParentClaims {
  userId: string;
  phone: string | null;
  email: string | null;
}

export interface ParentTokenVerifier {
  /** Returns the parent's claims, or null for any invalid, expired or non-user token. */
  verify(token: string): Promise<ParentClaims | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseJwtVerifier implements ParentTokenVerifier {
  private readonly jwks: JWTVerifyGetKey;
  private readonly secret: Uint8Array | undefined;

  constructor(options: { jwksUrl?: string; jwks?: JWTVerifyGetKey; legacySecret?: string }) {
    if (options.jwks) this.jwks = options.jwks;
    else if (options.jwksUrl) {
      this.jwks = createRemoteJWKSet(new URL(options.jwksUrl), { cooldownDuration: 30_000 });
    } else throw new Error('jwks or jwksUrl required');
    this.secret = options.legacySecret ? new TextEncoder().encode(options.legacySecret) : undefined;
  }

  async verify(token: string): Promise<ParentClaims | null> {
    try {
      const { alg } = decodeProtectedHeader(token);
      const options = { audience: 'authenticated', clockTolerance: 30 };
      let payload: JWTPayload;
      if (alg === 'HS256') {
        if (!this.secret) return null;
        ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, {
          ...options,
          algorithms: ['ES256', 'RS256', 'EdDSA'],
        }));
      }
      if (payload.role !== 'authenticated' || payload.is_anonymous === true) return null;
      if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return null;
      const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
      return { userId: payload.sub, phone: str(payload.phone), email: str(payload.email) };
    } catch {
      return null;
    }
  }
}
