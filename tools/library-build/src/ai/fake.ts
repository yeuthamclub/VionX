// `--fake`: the FakeAiProvider answering from recorded fixtures (tools/library-build/fixtures/
// <profile>/fake/*.json). No network, no cost. Batches end as soon as they are created, so a fake
// step submits, collects and finishes in one process.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeAiProvider, type ProviderRequest } from '@vionx/ai';
import { promptId } from './prompts.ts';

type Fixture = Record<string, unknown>;

export class FakeBuildProvider extends FakeAiProvider {
  private readonly cache = new Map<string, Fixture>();

  constructor(private readonly fixturesDir: string) {
    super();
    this.respondWith((request) => {
      const output = this.fixtureOutput(request);
      return {
        model: `fake:${request.model}`,
        text: JSON.stringify(output),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      };
    });
  }

  override async createBatch(requests: Parameters<FakeAiProvider['createBatch']>[0]) {
    const created = await super.createBatch(requests);
    this.endBatch(created.batchId);
    return created;
  }

  private fixture(name: string): Fixture {
    let f = this.cache.get(name);
    if (!f) {
      f = JSON.parse(readFileSync(resolve(this.fixturesDir, `${name}.json`), 'utf8')) as Fixture;
      this.cache.set(name, f);
    }
    return f;
  }

  private fixtureOutput(request: ProviderRequest): unknown {
    const input = JSON.parse(request.input) as Record<string, unknown>;
    const id = promptId(request.system);
    switch (id) {
      case 'page_extraction.v1':
      case 'page_reread.v1': {
        const pages = this.fixture('textlayer');
        const book = String(input.book);
        return {
          pages: (input.pages as number[]).map((page) => ({
            page,
            blocks: (pages[`${book}#${page}`] as unknown[] | undefined) ?? [],
          })),
        };
      }
      case 'skill_backbone.v1':
        return this.fixture('backbone');
      case 'lesson_mapping.v1':
        return this.fixture('map')[String(input.book)] ?? { lessons: [] };
      case 'prerequisite_edges.v1':
        return this.fixture('edges');
      case 'svg_illustration.v1':
        return this.fixture('media')[String(input.slotId)];
      case 'item_generation.v1':
      case 'item_generation.v2': {
        const drafts = this.fixture('generate');
        const attempt = Number(input.attempt ?? 1);
        const slots = input.slots as { slotId: string }[];
        return {
          items: slots
            .map((s) => drafts[`${s.slotId}@${attempt}`] ?? drafts[s.slotId])
            .filter((d) => d !== undefined),
        };
      }
      case 'item_verification.v1': {
        const item = input.item as { code: string };
        return this.fixture('verify')[item.code];
      }
      case 'item_dispute.v1': {
        const item = input.item as { code: string };
        return this.fixture('dispute')[item.code];
      }
      default:
        throw new Error(`FakeBuildProvider: no fixture for prompt ${id ?? '(none)'}`);
    }
  }
}
