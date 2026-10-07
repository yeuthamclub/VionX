import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_TASKS,
  DEFAULT_TASK_CONFIG,
  StaticTaskConfigSource,
  supportsRefusalFallback,
} from './index.ts';

const migration = readFileSync(
  resolve(import.meta.dirname, '../../../supabase/migrations/0001_base.sql'),
  'utf8',
);

/** Parses the ai_task_config seed rows out of migration 0001. */
function seededRows() {
  const block = migration.split('insert into ops.ai_task_config')[1]!.split(');\n')[0]!;
  const rows = [
    ...block.matchAll(/\('([a-z0-9_]+)',\s*'([^']+)',\s*'(\w+)',\s*(null|'\w+'),\s*(\d+),/g),
  ];
  return rows.map(([, task, model, mode, effort, maxTokens]) => ({
    task,
    model,
    mode,
    effort: effort === 'null' ? null : effort!.replaceAll("'", ''),
    maxTokens: Number(maxTokens),
  }));
}

describe('task config', () => {
  it('migration seed matches DEFAULT_TASK_CONFIG (ARCHITECTURE §4)', () => {
    const rows = seededRows();
    expect(rows.map((r) => r.task).sort()).toEqual([...AI_TASKS].sort());
    for (const row of rows) {
      const { task, model, mode, effort, maxTokens } =
        DEFAULT_TASK_CONFIG[row.task as keyof typeof DEFAULT_TASK_CONFIG];
      expect({ task, model, mode, effort, maxTokens }).toEqual(row);
    }
  });

  it('uses only the three agreed models, Haiku without effort', () => {
    for (const config of Object.values(DEFAULT_TASK_CONFIG)) {
      expect(['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5']).toContain(config.model);
      if (config.model === 'claude-haiku-4-5') expect(config.effort).toBeNull();
    }
  });

  it('content-building tasks use the Batch API', () => {
    for (const task of [
      'page_extraction',
      'item_generation',
      'item_verification',
      'item_dispute',
    ] as const) {
      expect(DEFAULT_TASK_CONFIG[task].mode).toBe('batch');
    }
  });

  it('applies overrides', async () => {
    const source = new StaticTaskConfigSource({ tutor_t2: { maxTokens: 10 } });
    expect((await source.get('tutor_t2')).maxTokens).toBe(10);
  });

  it('enables the refusal fallback only for Sonnet/Opus 5.5', () => {
    expect(supportsRefusalFallback('claude-sonnet-5-5')).toBe(true);
    expect(supportsRefusalFallback('claude-opus-5-5')).toBe(true);
    expect(supportsRefusalFallback('claude-haiku-4-5')).toBe(false);
  });
});
