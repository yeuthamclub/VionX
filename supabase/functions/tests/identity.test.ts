import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  CHILD_SESSION_HEADER,
  LiveActorResolver,
  requirePermission,
  type Actor,
  type ChildSessionStore,
} from '../_shared/actor.ts';
import {
  hashPin,
  newChildToken,
  sha256Hex,
  verifyAgainstDummy,
  verifyPin,
} from '../_shared/crypto.ts';
import { SupabaseJwtVerifier, type ParentTokenVerifier } from '../_shared/jwt.ts';
import { createApp } from '../api/app.ts';
import { noDatabase, type ApiDeps } from '../api/deps.ts';

const USER = '0b6b1a52-5d1e-4c43-9a43-6d9d1c0e7a11';

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

function token(
  key: CryptoKey | Uint8Array,
  claims: Record<string, unknown>,
  alg = 'ES256',
  exp = '1h',
) {
  return new SignJWT({ role: 'authenticated', phone: '84900000001', ...claims })
    .setProtectedHeader({ alg, kid: 'k1' })
    .setSubject(USER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

describe('SupabaseJwtVerifier', () => {
  it('accepts a user access token signed by a JWKS key', async () => {
    const { privateKey, jwks } = await keys();
    const verifier = new SupabaseJwtVerifier({ jwks });
    expect(await verifier.verify(await token(privateKey, {}))).toEqual({
      userId: USER,
      phone: '84900000001',
      email: null,
    });
  });

  it('rejects anon/service tokens, anonymous users, other audiences, expiry and foreign keys', async () => {
    const { privateKey, jwks } = await keys();
    const other = await keys();
    const verifier = new SupabaseJwtVerifier({ jwks });
    expect(await verifier.verify(await token(privateKey, { role: 'anon' }))).toBeNull();
    expect(await verifier.verify(await token(privateKey, { is_anonymous: true }))).toBeNull();
    expect(await verifier.verify(await token(privateKey, {}, 'ES256', '-5m'))).toBeNull();
    expect(await verifier.verify(await token(other.privateKey, {}))).toBeNull();
    const wrongAud = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(USER)
      .setAudience('somebody-else')
      .setExpirationTime('1h')
      .sign(privateKey);
    expect(await verifier.verify(wrongAud)).toBeNull();
    expect(await verifier.verify('not-a-jwt')).toBeNull();
  });

  it('accepts legacy HS256 only when the secret is configured', async () => {
    const { jwks } = await keys();
    const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
    const hs = await token(new TextEncoder().encode(secret), {}, 'HS256');
    expect(await new SupabaseJwtVerifier({ jwks }).verify(hs)).toBeNull();
    expect(await new SupabaseJwtVerifier({ jwks, legacySecret: secret }).verify(hs)).toMatchObject({
      userId: USER,
    });
  });
});

describe('PIN hashing and child tokens', () => {
  it('hashes PINs with argon2id and verifies them', async () => {
    const hash = await hashPin('2468');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPin('2468', hash)).toBe(true);
    expect(await verifyPin('2469', hash)).toBe(false);
    expect(await verifyPin('2468', 'garbage')).toBe(false);
    expect(await hashPin('2468')).not.toBe(hash); // random salt
    expect(await verifyAgainstDummy('2468')).toBe(false);
  });

  it('issues 32-byte base64url tokens stored as sha-256', async () => {
    const { token: t, tokenHash } = await newChildToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(await sha256Hex(t));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await newChildToken()).token).not.toBe(t);
  });
});

describe('LiveActorResolver', () => {
  const parentTokens: ParentTokenVerifier = {
    verify: async (t) => (t === 'good' ? { userId: USER, phone: null, email: 'a@b.c' } : null),
  };
  const seen: string[] = [];
  const childSessions: ChildSessionStore = {
    findActive: async (hash) => {
      seen.push(hash);
      return hash === (await sha256Hex('child-token'))
        ? { sessionId: 's1', childId: 'c1', householdId: 'h1' }
        : null;
    },
  };
  const resolver = new LiveActorResolver({ serviceSecret: 'svc', parentTokens, childSessions });
  const req = (headers: Record<string, string>) => new Request('http://local/', { headers });

  it('resolves system, child and parent actors', async () => {
    expect(await resolver.resolve(req({ 'x-vionx-service-secret': 'svc' }))).toEqual({
      kind: 'system',
    });
    expect(await resolver.resolve(req({ [CHILD_SESSION_HEADER]: 'child-token' }))).toEqual({
      kind: 'child',
      sessionId: 's1',
      childId: 'c1',
      householdId: 'h1',
    });
    expect(await resolver.resolve(req({ authorization: 'Bearer good' }))).toEqual({
      kind: 'parent',
      userId: USER,
      phone: null,
      email: 'a@b.c',
    });
  });

  it('looks child tokens up by hash only', async () => {
    seen.length = 0;
    await resolver.resolve(req({ [CHILD_SESSION_HEADER]: 'child-token' }));
    expect(seen).toEqual([await sha256Hex('child-token')]);
  });

  it('falls back to anonymous for anything unverifiable', async () => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Bearer bad' },
      { authorization: 'Basic good' },
      { [CHILD_SESSION_HEADER]: 'unknown' },
      { [CHILD_SESSION_HEADER]: 'x'.repeat(200) },
      { 'x-vionx-service-secret': 'wrong' },
    ];
    for (const headers of cases) {
      expect(await resolver.resolve(req(headers))).toEqual({ kind: 'anonymous' });
    }
  });
});

describe('requirePermission', () => {
  const parent: Actor = { kind: 'parent', userId: USER, phone: null, email: null };
  const store = (perms: string[]) => ({ permissionsOf: async () => perms });

  it('upgrades a parent with the permission (or SUPER_ADMIN) to admin', async () => {
    expect(await requirePermission(parent, store(['SUPPORT']), 'SUPPORT')).toEqual({
      kind: 'admin',
      userId: USER,
      permissions: ['SUPPORT'],
    });
    await expect(
      requirePermission(parent, store(['SUPER_ADMIN']), 'ANALYST'),
    ).resolves.toMatchObject({ kind: 'admin' });
  });

  it('rejects other parents, children and anonymous callers', async () => {
    await expect(requirePermission(parent, store(['ANALYST']), 'SUPPORT')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      requirePermission({ kind: 'anonymous' }, store(['SUPER_ADMIN']), 'SUPPORT'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      requirePermission(
        { kind: 'child', childId: 'c', householdId: 'h', sessionId: 's' },
        store([]),
        'SUPPORT',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('identity routes (guards and validation, no database)', () => {
  const deps = (actor: Actor): ApiDeps => ({
    version: 'test',
    allowedOrigins: [],
    actors: { resolve: async () => actor },
    sql: noDatabase,
    admins: { permissionsOf: async () => [] },
    probes: {
      db: async () => {},
      storage: async () => {},
      queue: async () => {},
      aiKeyPresent: false,
    },
  });
  const call = (actor: Actor, method: string, path: string, body?: unknown) =>
    createApp(deps(actor)).request(`http://local/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const id = '7d0c7d0e-4b8c-4c6f-9a3e-2f1b0c9d8e7f';
  const child: Actor = { kind: 'child', childId: 'c', householdId: 'h', sessionId: 's' };

  it.each([
    ['GET', '/v1/me', undefined],
    ['GET', '/v1/household', undefined],
    ['POST', '/v1/household', { name: 'Nhà' }],
    ['POST', '/v1/students', { displayName: 'A', birthYear: 2018, grade: 2 }],
    ['GET', `/v1/students/${id}`, undefined],
    ['PATCH', `/v1/students/${id}`, { grade: 3 }],
    ['POST', `/v1/students/${id}/reset-pin`, {}],
    ['POST', `/v1/students/${id}/revoke-sessions`, undefined],
    ['POST', `/v1/students/${id}/disable`, {}],
  ])('%s %s requires a parent', async (method, path, body) => {
    const anon = await call({ kind: 'anonymous' }, method, path, body);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    const asChild = await call(child, method, path, body);
    expect(asChild.status).toBe(403);
  });

  it('child session routes require a child session', async () => {
    expect((await call({ kind: 'anonymous' }, 'POST', '/v1/auth/child/logout')).status).toBe(401);
    expect((await call({ kind: 'anonymous' }, 'GET', '/v1/auth/child/session')).status).toBe(401);
    const parent: Actor = { kind: 'parent', userId: USER, phone: null, email: null };
    expect((await call(parent, 'GET', '/v1/auth/child/session')).status).toBe(403);
  });

  it('validates request bodies before touching data', async () => {
    const parent: Actor = { kind: 'parent', userId: USER, phone: null, email: null };
    const cases: [string, string, unknown][] = [
      ['POST', '/v1/students', { displayName: 'A', birthYear: 2018, grade: 13 }],
      ['POST', '/v1/students', { displayName: 'A', birthYear: 2018, grade: 2, pin: '12' }],
      ['POST', '/v1/students', { displayName: 'A', birthYear: 2018, grade: 2, avatar: 'dragon' }],
      ['POST', '/v1/household', { name: '' }],
      ['POST', '/v1/household', { name: 'A', timezone: 'Mars/Base' }],
      ['POST', `/v1/students/${id}/reset-pin`, { pin: 'abcd' }],
      ['GET', '/v1/students/not-a-uuid', undefined],
      ['POST', '/v1/auth/child/login', { childLoginId: 'vx-demy22', pin: '2468' }],
    ];
    for (const [method, path, body] of cases) {
      const res = await call(parent, method, path, body);
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('rejects a birth year outside the Grade 1-12 age range', async () => {
    const parent: Actor = { kind: 'parent', userId: USER, phone: null, email: null };
    const res = await call(parent, 'POST', '/v1/students', {
      displayName: 'A',
      birthYear: new Date().getUTCFullYear() - 1,
      grade: 2,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ code: 'BIRTH_YEAR' }],
    });
  });

  it('documents the identity routes and security schemes in OpenAPI', async () => {
    const res = await call({ kind: 'anonymous' }, 'GET', '/v1/openapi.json');
    const doc = (await res.json()) as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    for (const path of [
      '/api/v1/me',
      '/api/v1/household',
      '/api/v1/students',
      '/api/v1/students/{id}',
      '/api/v1/students/{id}/reset-pin',
      '/api/v1/students/{id}/revoke-sessions',
      '/api/v1/students/{id}/disable',
      '/api/v1/auth/child/login',
      '/api/v1/auth/child/logout',
      '/api/v1/auth/child/session',
    ]) {
      expect(doc.paths).toHaveProperty([path]);
    }
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      'bearerAuth',
      'childSession',
    ]);
  });
});
