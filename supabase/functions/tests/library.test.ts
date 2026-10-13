// M05 unit tests that need Node: the subject-profile seed matches the domain constant, the
// acceptance fixtures parse and validate, their templates hold over 10,000 seeds, and the admin
// routes refuse callers without a library permission (no database needed for that).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLibraryPackage } from '@vionx/contracts';
import {
  probeTemplate,
  renderVariant,
  SUBJECT_PROFILES,
  validateLibraryPackage,
  type LibraryPackage,
} from '@vionx/domain';
import { readPackageDir } from '../../../scripts/lib/library-files.ts';
import type { Actor, ActorResolver } from '../_shared/actor.ts';
import { createApp } from '../api/app.ts';
import { noDatabase } from '../api/deps.ts';

const root = resolve(import.meta.dirname, '../../..');
const FIXTURES = join(root, 'scripts/acceptance/fixtures/m05');
const migration = readFileSync(join(root, 'supabase/migrations/0008_library_core.sql'), 'utf8');

describe('subject profiles', () => {
  it('migration 0008 seeds the same 8 profiles as the domain constant', () => {
    const block = migration.split('insert into library.subject_profiles')[1]!.split(';\n')[0]!;
    const rows = [
      ...block.matchAll(
        /\((\d+), '(\w+)',\s*'([^']+)',\s*([\d.]+), ([\d.]+), ([\d.]+), (true|false),\s*'(\w+)', '(\w+)',\s*'(\{[^']*\})'\)/g,
      ),
    ].map((m) => ({
      grade: Number(m[1]),
      subject: m[2],
      titleVi: m[3],
      templateShare: Number(m[4]),
      groupShare: Number(m[5]),
      writtenShare: Number(m[6]),
      readAloudDefault: m[7] === 'true',
      ttsLang: m[8],
      imageLevel: m[9],
      itemTypeMix: JSON.parse(m[10]!),
      targetItems: 500,
    }));
    expect(rows).toEqual(SUBJECT_PROFILES);
    for (const p of SUBJECT_PROFILES) {
      const sum = Object.values(p.itemTypeMix).reduce((a, b) => a + b, 0);
      expect(sum, `${p.grade}-${p.subject}`).toBeCloseTo(1, 5);
    }
  });
});

const packages = ['gdpt2018/6-math', 'gdpt2018/2-math', 'gdpt2018/2-viet'];

async function load(name: string): Promise<LibraryPackage> {
  const parsed = await parseLibraryPackage(readPackageDir(join(FIXTURES, name)));
  if (!parsed.ok) throw new Error(`${name}: ${JSON.stringify(parsed.errors)}`);
  return parsed.pkg;
}

describe('acceptance fixtures', () => {
  it.each(packages)('%s parses, checksums match and the rules pass', async (name) => {
    const pkg = await load(name);
    expect(validateLibraryPackage(pkg).errors).toEqual([]);
  });

  it('the cycle fixture fails with the cycle path', async () => {
    const pkg = await load('invalid/6-math-cycle');
    expect(validateLibraryPackage(pkg).errors.map((e) => e.code)).toEqual(['PREREQUISITE_CYCLE']);
  });

  it('every fixture template holds its constraints over 10,000 seeds', async () => {
    for (const name of packages) {
      const pkg = await load(name);
      for (const template of pkg.templates) {
        const item = pkg.items.find((i) => i.code === template.item)!;
        const t = { ...template, type: item.type };
        expect(probeTemplate(t, 10_000), template.item).toEqual({ ok: true });
        // Determinism across calls.
        expect(renderVariant(t, 9_999)).toEqual(renderVariant(t, 9_999));
      }
    }
  });

  it('fixture folders are the ones the acceptance script imports', () => {
    expect(readdirSync(join(FIXTURES, 'gdpt2018')).sort()).toEqual(['2-math', '2-viet', '6-math']);
  });
});

class FixedActor implements ActorResolver {
  constructor(private readonly actor: Actor) {}
  async resolve(): Promise<Actor> {
    return this.actor;
  }
}

describe('admin library routes', () => {
  const app = (actor: Actor, permissions: string[] = []) =>
    createApp({
      version: 'test',
      allowedOrigins: [],
      actors: new FixedActor(actor),
      sql: noDatabase,
      admins: { permissionsOf: async () => permissions },
      probes: {
        db: async () => {},
        storage: async () => {},
        queue: async () => {},
        aiKeyPresent: false,
      },
    });
  const parent: Actor = {
    kind: 'parent',
    userId: '00000000-0000-4000-8000-000000000001',
    phone: null,
    email: null,
  };
  const child: Actor = {
    kind: 'child',
    childId: '00000000-0000-4000-8000-000000000002',
    householdId: '00000000-0000-4000-8000-000000000003',
    sessionId: '00000000-0000-4000-8000-000000000004',
  };

  it('answer 401 to anonymous callers and 403 to children, parents and other admin roles', async () => {
    const paths = ['/v1/admin/library', '/v1/admin/library/items', '/v1/admin/library/imports'];
    for (const path of paths) {
      expect((await app({ kind: 'anonymous' }).request(`http://local/api${path}`)).status).toBe(
        401,
      );
      expect((await app(child).request(`http://local/api${path}`)).status).toBe(403);
      expect((await app(parent).request(`http://local/api${path}`)).status).toBe(403);
      expect(
        (await app(parent, ['SUPPORT', 'ANALYST']).request(`http://local/api${path}`)).status,
      ).toBe(403);
    }
    const imp = await app(parent, ['LIBRARIAN', 'CONTENT_REVIEWER']).request(
      'http://local/api/v1/admin/library/import?mode=apply',
      { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array([1]) },
    );
    expect(imp.status).toBe(403);
  });
});
