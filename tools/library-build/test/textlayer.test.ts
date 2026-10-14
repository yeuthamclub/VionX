import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, BuildContext } from '../src/context.ts';
import type { FakeBuildProvider } from '../src/ai/fake.ts';
import { readPdfPages } from '../src/lib/pdf.ts';
import { classifyPage } from '../src/lib/text.ts';
import { buildProfile } from '../src/profile.ts';
import { loadPages, textlayer } from '../src/steps/textlayer.ts';

const SOURCE = join(FIXTURES_DIR, 'MATH.6/source');
const PDF = join(SOURCE, 'SGK-Toan6-tap1-fixture.pdf');

function context(fakeFixtures?: string) {
  return new BuildContext(buildProfile('MATH.6'), {
    fake: true,
    force: false,
    workDir: mkdtempSync(join(tmpdir(), 'x01-textlayer-')),
    waitMinutes: 0,
    pollSeconds: 0,
    ...(fakeFixtures ? { fakeFixtures } : {}),
    args: { source: SOURCE },
  });
}

describe('textlayer', () => {
  it('reads the text layer and spots the image-only page', async () => {
    const pages = await readPdfPages(new Uint8Array(readFileSync(PDF)));
    expect(pages).toHaveLength(2);
    expect(classifyPage(pages[0]!)).toBe('good');
    expect(pages[0]!.text).toContain('MỤC LỤC');
    expect(classifyPage(pages[1]!)).toBe('scanned');
  });

  it('sends only the image-only page to the vision model, as a PDF attachment', async () => {
    const ctx = context();
    await textlayer(ctx);
    const requests = (ctx.provider as FakeBuildProvider).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.attachments).toHaveLength(1);
    expect(requests[0]!.attachments![0]!.mediaType).toBe('application/pdf');
    expect(JSON.parse(requests[0]!.input).pages).toEqual([2]);

    const pages = loadPages(ctx);
    expect(pages.map((p) => [p.page, p.route, p.source])).toEqual([
      [1, 'TEXT', 'textlayer'],
      [2, 'AI', 'page_extraction'],
    ]);
    expect(pages[1]!.text).toContain('Chu vi của hình chữ nhật');
    expect(pages.some((p) => p.needsHuman)).toBe(false);

    // Idempotent: a re-run calls no model.
    await textlayer(ctx);
    expect(requests).toHaveLength(1);
  });

  it('re-reads a failed reading once, then flags the page for a human', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x01-fixtures-'));
    cpSync(join(FIXTURES_DIR, 'MATH.6/fake'), dir, { recursive: true });
    writeFileSync(join(dir, 'textlayer.json'), '{}');
    const ctx = context(dir);
    await textlayer(ctx);
    const requests = (ctx.provider as FakeBuildProvider).requests;
    expect(requests.map((r) => r.system.match(/prompt: (\S+)/)?.[1])).toEqual([
      'page_extraction.v1',
      'page_reread.v1',
    ]);
    const page = loadPages(ctx).find((p) => p.page === 2)!;
    expect(page.needsHuman).toBe(true);
    expect(page.problems.length).toBeGreaterThan(0);
  });
});
