import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_TASKS,
  DEFAULT_TASK_CONFIG,
  StaticTaskConfigSource,
  supportsRefusalFallback,
} from './index.ts';

const MIGRATIONS = resolve(import.meta.dirname, '../../../supabase/migrations');
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'));

/** The ai_task_config rows after every migration: the 0001 seed, then later effort updates. */
function seededRows() {
  const block = migrations[0]!.split('insert into ops.ai_task_config')[1]!.split(');\n')[0]!;
  const rows = [
    ...block.matchAll(/\('([a-z0-9_]+)',\s*'([^']+)',\s*'(\w+)',\s*(null|'\w+'),\s*(\d+),/g),
  ].map(([, task, model, mode, effort, maxTokens]) => ({
    task,
    model,
    mode,
    effort: effort === 'null' ? null : effort!.replaceAll("'", ''),
    maxTokens: Number(maxTokens),
  }));
  for (const sql of migrations.slice(1)) {
    const updates = [
      ...sql.matchAll(
        /update ops\.ai_task_config set effort = (null|'\w+') where task = '([a-z0-9_]+)';/g,
      ),
    ];
    // Any other kind of update would be missed here: extend the parser first.
    expect(updates.length).toBe(sql.split('update ops.ai_task_config').length - 1);
    for (const [, effort, task] of updates) {
      const row = rows.find((r) => r.task === task)!;
      row.effort = effort === 'null' ? null : effort!.replaceAll("'", '');
    }
  }
  return rows;
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
