// Fake end-to-end run of every step for one topic (no network, no cost), in a temp work dir.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLibraryPackage } from '@vionx/contracts';
import { validateLibraryPackage } from '@vionx/domain';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { simulateReview } from '../fixtures/simulate-review.ts';
import { main } from '../src/cli.ts';
import { FIXTURES_DIR } from '../src/context.ts';

describe('library:build MATH.6 --fake', () => {
  it('builds a small reviewed package that validates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x01-e2e-'));
    const run = (...argv: string[]) => main(['MATH.6', ...argv, '--fake', '--work-dir', dir]);
    const topic = ['--topic', 'MATH.6.GEO.SHAPE'];

    expect(
      await run(
        'textlayer,backbone,map,edges,plan',
        '--source',
        join(FIXTURES_DIR, 'MATH.6/source'),
        '--gdpt',
        join(FIXTURES_DIR, 'MATH.6/gdpt-lop6-excerpt.txt'),
        '--target',
        '28',
      ),
    ).toBe(0);
    expect(existsSync(join(dir, 'plan.csv'))).toBe(true);
    // Generation refuses an unapproved plan.
    await expect(run('generate', ...topic)).rejects.toThrow(/plan/);
    expect(await run('plan', '--approve', '--by', 'test')).toBe(0);
    expect(await run('passages,media,generate,check,generate,check', ...topic)).toBe(0);
    expect(await run('verify,review-export', ...topic)).toBe(0);

    const reviewed = simulateReview(dir);
    expect(await run('review-import', '--file', reviewed, '--reviewer', 'Test Reviewer')).toBe(0);
    expect(await run('package')).toBe(0);

    const zip = join(dir, 'package', '6-math.zip');
    expect(existsSync(zip)).toBe(true);
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    expect(report.acceptance.ok).toBe(false); // 9 items is not a library; never faked
    const parsed = await parseLibraryPackage(unzipSync(new Uint8Array(readFileSync(zip))));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.pkg.items).toHaveLength(9);
    expect(parsed.pkg.items.every((i) => i.status === 'APPROVED')).toBe(true);
    expect(parsed.pkg.manifest.reviewer).toBe('Test Reviewer');
    expect(validateLibraryPackage(parsed.pkg, { templateSeeds: 200 }).errors).toEqual([]);
  });
});
