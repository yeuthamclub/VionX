import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_EVENT_TYPES, SCHOOL_SUBJECTS, VERIFICATION_MODES } from '@vionx/domain';
import { SkeletonActorResolver } from '../_shared/actor.ts';
import { MemoryStorage, SupabaseStorage } from '../_shared/storage.ts';
import { createApp } from '../api/app.ts';
import { noDatabase } from '../api/deps.ts';
import { createHandlers } from '../worker/handlers.ts';
import { EXPORT_SECTIONS } from '../worker/privacy-export.ts';

const root = resolve(import.meta.dirname, '../../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/0007_calendar_tasks.sql'),
  'utf8',
);
const ID = '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c';

describe('api without a database (calendar & tasks)', () => {
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
    ['GET', `/v1/students/${ID}/calendar?from=2026-10-12&to=2026-10-18`],
    ['GET', `/v1/students/${ID}/timetable`],
    ['GET', '/v1/task-templates'],
    ['GET', '/v1/approvals'],
    ['GET', `/v1/tasks/${ID}`],
    ['DELETE', `/v1/timetable/${ID}`],
    ['DELETE', `/v1/events/${ID}`],
  ])('%s %s requires a signed-in actor', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
  });

  it('validates bodies before touching data', async () => {
    const cases: [string, string, unknown][] = [
      ['POST', `/v1/tasks/${ID}/complete`, { clientUuid: 'not-a-uuid' }],
      ['POST', `/v1/tasks/${ID}/complete`, { clientUuid: ID, date: '2026-02-30' }],
      ['POST', `/v1/tasks/${ID}/approve`, {}],
      [
        'POST',
        `/v1/students/${ID}/tasks`,
        { type: 'HOMEWORK', title: 'x', verificationMode: 'BY_MAGIC' },
      ],
      [
        'POST',
        `/v1/students/${ID}/tasks`,
        { type: 'HOMEWORK', title: '', verificationMode: 'SELF_CHECK' },
      ],
      [
        'POST',
        `/v1/students/${ID}/timetable`,
        { weekday: 8, startTime: '07:00', endTime: '07:45', subjectCode: 'TOAN' },
      ],
      [
        'POST',
        `/v1/students/${ID}/timetable`,
        { weekday: 1, startTime: '7:00', endTime: '07:45', subjectCode: 'TOAN' },
      ],
      [
        'POST',
        `/v1/students/${ID}/events`,
        {
          type: 'PARTY',
          title: 'x',
          startsAt: '2026-10-12T00:00:00Z',
          endsAt: '2026-10-12T01:00:00Z',
        },
      ],
      ['POST', '/v1/uploads/sign', { purpose: 'TASK_PROOF', taskId: ID, contentType: 'image/gif' }],
      ['GET', `/v1/students/${ID}/calendar?from=2026-10-12`, undefined],
    ];
    for (const [method, path, body] of cases) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(400);
    }
  });

  it('documents every M03 route in the OpenAPI document', async () => {
    const doc = (await (await call('GET', '/v1/openapi.json')).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const [path, method] of [
      ['/v1/students/{id}/calendar', 'get'],
      ['/v1/students/{id}/timetable', 'post'],
      ['/v1/timetable/{entryId}', 'patch'],
      ['/v1/students/{id}/events', 'post'],
      ['/v1/events/{eventId}', 'delete'],
      ['/v1/students/{id}/tasks', 'post'],
      ['/v1/tasks/{id}', 'patch'],
      ['/v1/tasks/{id}/complete', 'post'],
      ['/v1/tasks/{id}/approve', 'post'],
      ['/v1/tasks/{id}/reject', 'post'],
      ['/v1/approvals', 'get'],
      ['/v1/uploads/sign', 'post'],
    ] as const) {
      expect(doc.paths[`/api${path}`]?.[method], `${method} ${path}`).toBeDefined();
    }
  });
});

describe('migration 0007 mirrors the domain lists', () => {
  it('has every subject, event type and verification mode', () => {
    for (const s of SCHOOL_SUBJECTS) {
      expect(migration).toContain(
        `('${s.code}', '${s.nameVi}', '${s.nameEn}', ${s.gradeFrom}, ${s.gradeTo},`,
      );
    }
    for (const t of CALENDAR_EVENT_TYPES) expect(migration).toContain(`'${t}'`);
    for (const m of VERIFICATION_MODES) expect(migration).toContain(`'${m}'`);
    expect(migration).toContain("cron.schedule('vionx-task-materialise'");
  });
});

describe('worker and storage for M03', () => {
  it('registers the daily materialisation consumer', () => {
    const handlers = createHandlers({
      storage: new MemoryStorage(),
      notifier: { notify: async () => {} },
    });
    expect(Object.keys(handlers)).toContain('task.materialise_requested');
  });

  it('exports the calendar and task data with the household', () => {
    expect(EXPORT_SECTIONS.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        'timetable.json',
        'calendar_events.json',
        'tasks.json',
        'task_days.json',
        'task_completions.json',
      ]),
    );
  });

  it('signs uploads on the public URL', async () => {
    const calls: string[] = [];
    const storage = new SupabaseStorage({
      url: 'http://kong:8000',
      serviceRoleKey: 'key',
      publicUrl: 'http://127.0.0.1:54321/',
      fetch: (async (url: string) => {
        calls.push(url);
        return Response.json({ url: '/object/upload/sign/task-proofs/h/s/t/f.jpg?token=t' });
      }) as unknown as typeof fetch,
    });
    const url = await storage.createSignedUploadUrl('task-proofs', 'h/s/t/f.jpg');
    expect(calls[0]).toBe('http://kong:8000/storage/v1/object/upload/sign/task-proofs/h/s/t/f.jpg');
    expect(url).toBe(
      'http://127.0.0.1:54321/storage/v1/object/upload/sign/task-proofs/h/s/t/f.jpg?token=t',
    );
  });
});
