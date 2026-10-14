import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REWARD_RULES, SYSTEM_CAPS, systemCapRows } from '@vionx/domain';
import { SkeletonActorResolver } from '../_shared/actor.ts';
import { MemoryStorage } from '../_shared/storage.ts';
import { createApp } from '../api/app.ts';
import { noDatabase } from '../api/deps.ts';
import { createHandlers } from '../worker/handlers.ts';
import { EXPORT_SECTIONS } from '../worker/privacy-export.ts';

const root = resolve(import.meta.dirname, '../../..');
const migration = readFileSync(resolve(root, 'supabase/migrations/0009_rewards.sql'), 'utf8');
const ID = '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c';

describe('api without a database (rewards)', () => {
  const app = createApp({
    version: 'test',
    allowedOrigins: [],
    actors: new SkeletonActorResolver('s'),
    sql: noDatabase,
    admins: { permissionsOf: async () => [] },
    probes: {
      db: async () => {},
      storage: async () => {},
      queue: async () => {},
      aiKeyPresent: false,
    },
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(`http://local/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it.each([
    ['GET', `/v1/students/${ID}/rewards/wallet`],
    ['GET', `/v1/students/${ID}/rewards/ledger`],
    ['GET', '/v1/household/reward-rules'],
    ['GET', '/v1/household/reward-catalog'],
    ['GET', '/v1/reward-redemptions'],
    ['DELETE', `/v1/household/reward-catalog/${ID}`],
  ])('%s %s requires a signed-in actor', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });

  it('validates bodies and queries before touching data', async () => {
    const cases: [string, string, unknown][] = [
      ['PATCH', '/v1/household/reward-rules', { weekdayCapCoins: -1 }],
      ['PATCH', '/v1/household/reward-rules', { weekendTierCaps: [20, 30, 40] }],
      ['PATCH', '/v1/household/reward-rules', { weekendGoals: { readingTasks: 0 } }],
      ['POST', '/v1/household/reward-catalog', { title: '', costCoins: 5 }],
      ['POST', '/v1/household/reward-catalog', { title: 'Kem', costCoins: 10_001 }],
      ['POST', '/v1/household/reward-catalog', { title: 'Kem', costCoins: 5, icon: 'rocket' }],
      ['POST', '/v1/reward-redemptions', { clientUuid: 'nope', itemId: ID }],
      ['GET', `/v1/students/${ID}/rewards/ledger?kind=gold`, undefined],
      ['GET', `/v1/students/${ID}/rewards/ledger?limit=500`, undefined],
      ['GET', '/v1/reward-redemptions?status=MAYBE', undefined],
    ];
    for (const [method, path, body] of cases) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(400);
    }
  });

  it('documents every M04 route in the OpenAPI document', async () => {
    const doc = (await (await call('GET', '/v1/openapi.json')).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(doc.paths['/api/v1/students/{id}/rewards/wallet']!)).toEqual(['get']);
    expect(Object.keys(doc.paths['/api/v1/household/reward-rules']!).sort()).toEqual([
      'get',
      'patch',
    ]);
    expect(Object.keys(doc.paths['/api/v1/household/reward-catalog']!).sort()).toEqual([
      'get',
      'post',
    ]);
    expect(Object.keys(doc.paths['/api/v1/household/reward-catalog/{itemId}']!).sort()).toEqual([
      'delete',
      'patch',
    ]);
    expect(doc.paths['/api/v1/reward-redemptions/{id}/approve']).toBeDefined();
    expect(doc.paths['/api/v1/reward-redemptions/{id}/reject']).toBeDefined();
  });
});

describe('migration and worker for M04', () => {
  it('seeds the system caps and the default rules of @vionx/domain', () => {
    for (const [key, value] of Object.entries(systemCapRows(SYSTEM_CAPS))) {
      expect(migration).toMatch(new RegExp(`\\('${key}', ${value},`));
    }
    const json = /values \(null, 1, '(\{[\s\S]*?\})'::jsonb\)/.exec(migration)?.[1];
    expect(JSON.parse(json!)).toEqual(DEFAULT_REWARD_RULES);
    expect(migration).toContain("cron.schedule('vionx-reward-settlement'");
    expect(migration).toContain('ops.ledger_append_only()');
  });

  it('registers the reward consumers', () => {
    const handlers = createHandlers({
      storage: new MemoryStorage(),
      notifier: { notify: async () => {} },
    });
    expect(Object.keys(handlers)).toEqual(
      expect.arrayContaining(['task.approved', 'task.completed', 'reward.settlement_requested']),
    );
  });

  it('exports the reward data with the household', () => {
    expect(EXPORT_SECTIONS.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        'reward_rules.json',
        'xp_ledger.json',
        'coin_ledger.json',
        'reward_days.json',
        'reward_catalog.json',
        'reward_redemptions.json',
      ]),
    );
  });
});
