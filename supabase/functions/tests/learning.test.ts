import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTERY_CONFIG } from '@vionx/domain';
import { SkeletonActorResolver } from '../_shared/actor.ts';
import { MemoryStorage } from '../_shared/storage.ts';
import { createApp } from '../api/app.ts';
import { noDatabase } from '../api/deps.ts';
import { createHandlers } from '../worker/handlers.ts';
import { EXPORT_SECTIONS } from '../worker/privacy-export.ts';

const root = resolve(import.meta.dirname, '../../..');
const migration = readFileSync(resolve(root, 'supabase/migrations/0010_learning.sql'), 'utf8');
const ID = '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c';

describe('api without a database (learning)', () => {
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
    ['POST', '/v1/learning/sessions', { clientUuid: ID, nodeId: ID }],
    ['GET', `/v1/learning/sessions/${ID}/next`, undefined],
    ['POST', `/v1/learning/sessions/${ID}/answers`, { clientUuid: ID, itemId: ID, response: {} }],
    ['POST', `/v1/learning/sessions/${ID}/hint`, undefined],
    ['POST', `/v1/learning/sessions/${ID}/finish`, undefined],
    ['GET', `/v1/students/${ID}/knowledge-map`, undefined],
    ['GET', `/v1/students/${ID}/learning-path`, undefined],
    ['POST', `/v1/items/${ID}/report`, { reason: 'TYPO' }],
  ])('%s %s requires a signed-in actor', async (method, path, body) => {
    expect((await call(method, path, body)).status).toBe(401);
  });

  it('validates bodies and queries before touching data', async () => {
    const cases: [string, string, unknown][] = [
      ['POST', '/v1/learning/sessions', { clientUuid: 'nope', nodeId: ID }],
      ['POST', '/v1/learning/sessions', { clientUuid: ID, nodeId: ID, mode: 'EXAM' }],
      ['POST', '/v1/learning/sessions', { clientUuid: ID, nodeId: ID, targetItems: 0 }],
      ['POST', `/v1/learning/sessions/${ID}/answers`, { clientUuid: ID, itemId: ID }],
      ['POST', `/v1/learning/sessions/${ID}/answers`, { clientUuid: ID, itemId: ID, response: 3 }],
      ['GET', '/v1/learning/sessions/nope/next', undefined],
      ['GET', `/v1/students/${ID}/knowledge-map?subject=Math`, undefined],
      ['POST', `/v1/items/${ID}/report`, { reason: 'BORING' }],
      ['POST', `/v1/items/${ID}/report`, { reason: 'TYPO', variantSeed: -1 }],
    ];
    for (const [method, path, body] of cases) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it('documents every M06 route in the OpenAPI document', async () => {
    const doc = (await (await call('GET', '/v1/openapi.json')).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const routes: [string, string][] = [
      ['/api/v1/learning/sessions', 'post'],
      ['/api/v1/learning/sessions/{id}/next', 'get'],
      ['/api/v1/learning/sessions/{id}/answers', 'post'],
      ['/api/v1/learning/sessions/{id}/hint', 'post'],
      ['/api/v1/learning/sessions/{id}/finish', 'post'],
      ['/api/v1/students/{id}/knowledge-map', 'get'],
      ['/api/v1/students/{id}/learning-path', 'get'],
      ['/api/v1/items/{id}/report', 'post'],
    ];
    for (const [path, method] of routes) {
      expect(Object.keys(doc.paths[path] ?? {}), path).toEqual([method]);
    }
    // The item a child sees has no answer, feedback or solution field.
    const schemas = (
      doc as unknown as {
        components: { schemas: Record<string, { properties: Record<string, unknown> }> };
      }
    ).components.schemas;
    const fields = ['PracticeItem', 'PracticeOption', 'PracticeGroup'].flatMap((name) =>
      Object.keys(schemas[name]!.properties),
    );
    expect(fields.filter((f) => /answer|feedback|solution|explanation|correct/i.test(f))).toEqual(
      [],
    );
  });
});

describe('migration and worker for M06', () => {
  it('seeds the mastery config of @vionx/domain', () => {
    const json = /values \(1, '(\{[\s\S]*?\})'::jsonb\)/.exec(migration)?.[1];
    expect(JSON.parse(json!)).toEqual(DEFAULT_MASTERY_CONFIG);
    expect(migration).toContain("cron.schedule('vionx-learning-nightly'");
  });

  it('gives every learning table a household, RLS and no client grant', () => {
    const tables = [...migration.matchAll(/create table app\.(\w+) \(([\s\S]*?)\n\);/g)];
    expect(tables.map((t) => t[1])).toEqual([
      'mastery_config',
      'learning_sessions',
      'answer_attempts',
      'student_skill_states',
      'review_schedule',
      'mistake_patterns',
      'student_item_history',
    ]);
    for (const [, name, columns] of tables) {
      expect(migration).toContain(`alter table app.${name} enable row level security;`);
      if (name === 'mastery_config') continue;
      expect(columns, name).toContain('household_id uuid not null');
      expect(migration).toMatch(new RegExp(`create index \\w+ on app\\.${name} \\(household_id`));
    }
    expect(migration).toContain(
      'revoke all on all tables in schema app, ops from public, anon, authenticated;',
    );
    expect(migration).not.toMatch(/grant .* to (anon|authenticated)/);
  });

  it('the nightly aggregate copies no student or household id into the library schema', () => {
    const fn = /create or replace function ops\.learning_nightly[\s\S]*?\$\$;/.exec(migration)![0];
    const insert = /insert into library\.item_stats[\s\S]*?get diagnostics/.exec(fn)![0];
    expect(insert).not.toMatch(/student_id|household_id|session_id/);
  });

  it('registers the session XP consumer and exports the learning data', () => {
    const handlers = createHandlers({
      storage: new MemoryStorage(),
      notifier: { notify: async () => {} },
    });
    expect(Object.keys(handlers)).toContain('learning.session_finished');
    expect(EXPORT_SECTIONS.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        'learning_sessions.json',
        'answer_attempts.json',
        'skill_states.json',
        'mistake_patterns.json',
        'item_history.json',
      ]),
    );
  });
});
