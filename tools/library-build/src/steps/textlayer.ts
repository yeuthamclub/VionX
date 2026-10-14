// Step 1 `textlayer --source <dir | bucket:<bucket>/<prefix>>`: the text layer of every page
// (pdf.js), classified good / legacy-encoding / scanned / formula-heavy. Good pages need no AI;
// the others go to the vision model in 10-page PDFs (page_extraction, Batch). Readings that fail
// validation are re-read one page at a time (page_reread, Batch); what still fails is flagged for
// a human. Output: pages.jsonl.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pageExtractionOutputSchema } from '@vionx/ai/schemas';
import { runBatch, type BatchJob } from '../ai/batch.ts';
import { PROMPT_VERSIONS, systemPrompt } from '../ai/prompts.ts';
import type { BuildContext } from '../context.ts';
import { katexProblem } from '../lib/katex-check.ts';
import { readJsonIf, writeFileAtomic, writeJson, writeJsonl } from '../lib/jsonl.ts';
import { extractPages, readPdfPages } from '../lib/pdf.ts';
import { downloadObject, listObjects } from '../lib/storage.ts';
import {
  classifyPage,
  MIN_TEXT_CHARS,
  vietnameseScore,
  wordJaccard,
  words,
  type PageQuality,
} from '../lib/text.ts';

export type BookKind = 'SGK' | 'SGV' | 'SBT';

export interface SourceBook {
  id: string;
  kind: BookKind;
  file: string;
  sha256: string;
  pages: number;
}

export interface PageRecord {
  book: string;
  kind: BookKind;
  page: number;
  quality: PageQuality;
  route: 'TEXT' | 'AI';
  source: 'textlayer' | 'page_extraction' | 'page_reread';
  text: string;
  blocks?: { type: string; text: string; latex: string | null }[];
  problems: string[];
  needsHuman: boolean;
}

interface LayerPage {
  page: number;
  text: string;
  hasImage: boolean;
  quality: PageQuality;
}

type Extraction = { pages: { page: number; blocks: NonNullable<PageRecord['blocks']> }[] };

const CHUNK = 10;

export const bookKind = (name: string): BookKind =>
  /sgv|giao[ _-]?vien/i.test(name) ? 'SGV' : /sbt|bai[ _-]?tap/i.test(name) ? 'SBT' : 'SGK';

const bookId = (file: string) =>
  basename(file)
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-');

async function gatherSources(ctx: BuildContext, source: string): Promise<string[]> {
  if (source.startsWith('bucket:')) {
    const [bucket, ...rest] = source.slice('bucket:'.length).split('/');
    const prefix = rest.join('/');
    const files: string[] = [];
    for (const object of await listObjects(bucket!, prefix)) {
      if (!/\.pdf$/i.test(object)) continue;
      const local = ctx.path('sources', basename(object));
      if (!ctx.has('sources', basename(object))) {
        ctx.log(`  downloading ${bucket}/${object}`);
        writeFileAtomic(local, await downloadObject(bucket!, object));
      }
      files.push(local);
    }
    return files;
  }
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), source);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.pdf$/i.test(name)) files.push(full);
    }
  };
  walk(dir);
  return files;
}

/** Validation after a model reading (BOOK_PIPELINE §4). */
export function readingProblems(
  blocks: NonNullable<PageRecord['blocks']>,
  layerText: string,
): string[] {
  const problems: string[] = [];
  const text = blocks.map((b) => b.text).join('\n');
  const katex = katexProblem([
    ...blocks.map((b) => b.text),
    ...blocks.map((b) => (b.latex ? `$${b.latex}$` : null)),
  ]);
  if (katex) problems.push(katex);
  if (words(text).length === 0) problems.push('no text read (blank page? a human should confirm)');
  if (words(text).length >= 20) {
    const { validRatio, diacriticRatio } = vietnameseScore(text);
    if (validRatio < 0.6 || diacriticRatio < 0.1)
      problems.push(
        `Vietnamese text check failed (valid ${validRatio.toFixed(2)}, diacritics ${diacriticRatio.toFixed(2)})`,
      );
  }
  if (layerText.replace(/\s+/g, '').length >= MIN_TEXT_CHARS) {
    const sim = wordJaccard(layerText, text);
    if (sim < 0.5)
      problems.push(`differs from the partial text layer (similarity ${sim.toFixed(2)})`);
  }
  return problems;
}

export async function textlayer(ctx: BuildContext): Promise<void> {
  const previous = ctx.state().steps.textlayer;
  const source = ctx.arg('source') ?? (previous?.source as string | undefined);
  if (!source)
    throw new Error(
      'textlayer needs --source <dir with the SGK/SGV/SBT PDFs> or --source bucket:sources/6-math',
    );
  const files = await gatherSources(ctx, source);
  if (files.length === 0) throw new Error(`no PDF files under ${source}`);

  // Phase 1: text layer, no AI. Cached per file hash.
  const books: SourceBook[] = [];
  const layers = new Map<string, LayerPage[]>();
  const bytesOf = new Map<string, Uint8Array>();
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const id = bookId(file);
    const cachePath = ctx.path('textlayer', `${id}.layer.json`);
    let layer = readJsonIf<{ sha256: string; pages: LayerPage[] }>(cachePath);
    if (layer?.sha256 !== sha256) {
      const pages = (await readPdfPages(bytes)).map((p) => ({ ...p, quality: classifyPage(p) }));
      layer = { sha256, pages };
      writeJson(cachePath, layer);
    }
    books.push({ id, kind: bookKind(basename(file)), file, sha256, pages: layer.pages.length });
    layers.set(id, layer.pages);
    bytesOf.set(id, bytes);
    const hard = layer.pages.filter((p) => p.quality !== 'good').length;
    ctx.log(
      `  ${id} (${bookKind(basename(file))}): ${layer.pages.length} pages, ${layer.pages.length - hard} text layer, ${hard} to the vision model`,
    );
  }
  writeJson(ctx.path('sources.json'), books);

  // Phase 2: hard pages in 10-page PDFs → page_extraction (Batch).
  const system = systemPrompt(PROMPT_VERSIONS.textlayer);
  const jobs: BatchJob[] = [];
  for (const book of books) {
    const hard = layers
      .get(book.id)!
      .filter((p) => p.quality !== 'good')
      .map((p) => p.page);
    for (let i = 0; i < hard.length; i += CHUNK) {
      const pages = hard.slice(i, i + CHUNK);
      jobs.push({
        key: `${book.id}#${pages[0]}-${pages[pages.length - 1]}`,
        item: {
          system,
          input: {
            book: book.id,
            kind: book.kind,
            pages,
            note: 'PDF page i is book page pages[i-1].',
          },
          attachments: [
            {
              mediaType: 'application/pdf',
              data: Buffer.from(await extractPages(bytesOf.get(book.id)!, pages)).toString(
                'base64',
              ),
            },
          ],
          outputSchema: pageExtractionOutputSchema,
          sourceRefs: [`${book.kind}:${book.id}:${pages[0]}-${pages[pages.length - 1]}`],
        },
      });
    }
  }
  const first = await runBatch<Extraction>(
    ctx,
    'textlayer',
    'page_extraction',
    PROMPT_VERSIONS.textlayer,
    jobs,
  );
  if (!first.complete) {
    ctx.markStep('textlayer', 'pending', { source });
    return;
  }

  const records = new Map<string, PageRecord>();
  const keyOf = (book: string, page: number) => `${book}#${page}`;
  const failed: { book: SourceBook; page: number; problems: string[] }[] = [];
  for (const book of books) {
    for (const p of layers.get(book.id)!) {
      records.set(keyOf(book.id, p.page), {
        book: book.id,
        kind: book.kind,
        page: p.page,
        quality: p.quality,
        route: p.quality === 'good' ? 'TEXT' : 'AI',
        source: 'textlayer',
        text: p.quality === 'good' ? p.text : '',
        problems: [],
        needsHuman: false,
      });
    }
  }
  const applyReading = (job: BatchJob, output: Extraction, source: PageRecord['source']) => {
    const input = job.item.input as { book: string; pages: number[] };
    const seen = new Map<number, number>();
    for (const p of output.pages) seen.set(p.page, (seen.get(p.page) ?? 0) + 1);
    for (const page of input.pages) {
      const record = records.get(keyOf(input.book, page))!;
      const reading = output.pages.find((p) => p.page === page);
      const problems: string[] = [];
      if (!reading) problems.push('page missing from the reading');
      if ((seen.get(page) ?? 0) > 1) problems.push('page returned more than once');
      const blocks = reading?.blocks ?? [];
      const layerText = layers.get(input.book)!.find((l) => l.page === page)!.text;
      problems.push(...readingProblems(blocks, layerText));
      Object.assign(record, {
        source,
        blocks,
        text: blocks.map((b) => b.text).join('\n'),
        problems,
      });
    }
    for (const p of output.pages) {
      if (!input.pages.includes(p.page))
        ctx.log(`  ! ${job.key}: unexpected page ${p.page} ignored`);
    }
  };
  for (const job of jobs) applyReading(job, first.results.get(job.key)!.output!, 'page_extraction');
  for (const r of records.values()) {
    if (r.route === 'AI' && r.problems.length > 0)
      failed.push({
        book: books.find((b) => b.id === r.book)!,
        page: r.page,
        problems: r.problems,
      });
  }

  // Phase 3: failed readings → page_reread one page at a time (Batch).
  if (failed.length > 0) {
    ctx.log(`  ${failed.length} page(s) failed validation; re-reading them one by one`);
    const rereadSystem = systemPrompt(PROMPT_VERSIONS.reread);
    const rereadJobs: BatchJob[] = [];
    for (const f of failed) {
      rereadJobs.push({
        key: keyOf(f.book.id, f.page),
        item: {
          system: rereadSystem,
          input: { book: f.book.id, kind: f.book.kind, pages: [f.page], problems: f.problems },
          attachments: [
            {
              mediaType: 'application/pdf',
              data: Buffer.from(await extractPages(bytesOf.get(f.book.id)!, [f.page])).toString(
                'base64',
              ),
            },
          ],
          outputSchema: pageExtractionOutputSchema,
          sourceRefs: [`${f.book.kind}:${f.book.id}:${f.page}`],
        },
      });
    }
    const second = await runBatch<Extraction>(
      ctx,
      'textlayer-reread',
      'page_reread',
      PROMPT_VERSIONS.reread,
      rereadJobs,
    );
    if (!second.complete) {
      ctx.markStep('textlayer', 'pending', { source });
      return;
    }
    for (const job of rereadJobs)
      applyReading(job, second.results.get(job.key)!.output!, 'page_reread');
    for (const r of records.values())
      if (r.route === 'AI' && r.problems.length > 0) r.needsHuman = true;
  }

  const all = [...records.values()].sort((a, b) => a.book.localeCompare(b.book) || a.page - b.page);
  writeJsonl(ctx.path('pages.jsonl'), all);
  const human = all.filter((r) => r.needsHuman);
  for (const r of human)
    ctx.log(`  needs a human: ${r.book} p.${r.page}: ${r.problems.join('; ')}`);
  ctx.markStep('textlayer', 'done', {
    source,
    pages: all.length,
    textPages: all.filter((r) => r.route === 'TEXT').length,
    aiPages: all.filter((r) => r.route === 'AI').length,
    needsHuman: human.length,
  });
  ctx.log(
    `textlayer: ${all.length} pages (${all.filter((r) => r.route === 'TEXT').length} text layer, ${all.filter((r) => r.route === 'AI').length} vision), ${human.length} need a human → pages.jsonl`,
  );
}

/** Reads pages.jsonl. */
export const loadPages = (ctx: BuildContext): PageRecord[] =>
  readFileSync(ctx.path('pages.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PageRecord);
