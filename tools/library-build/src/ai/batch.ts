// Resumable Batch API jobs. Each job has a stable key; results are stored per key in
// `batches/<name>.results.jsonl` and submitted batches in `batches/<name>.json`. Re-running a step
// polls pending batches, collects finished ones, and submits only keys without a good result, so
// nothing is paid for twice and a failed request is resubmitted on the next run.
import { createHash } from 'node:crypto';
import type { AiTaskName, BatchItem } from '@vionx/ai';
import type { BuildContext } from '../context.ts';
import { readJsonIf, readJsonl, writeJson, writeJsonl } from '../lib/jsonl.ts';

export interface BatchJob {
  key: string;
  item: Omit<BatchItem, 'customId'>;
}

export interface BatchResult<T> {
  key: string;
  ok: boolean;
  output?: T;
  error?: string;
  batchId: string;
  model?: string;
}

interface Submission {
  batchId: string;
  model: string;
  /** customId → job key. */
  keys: Record<string, string>;
  status: 'pending' | 'collected';
  submittedAt: string;
}

export interface BatchOutcome<T> {
  /** Every job has a successful result. */
  complete: boolean;
  /** Latest result per key. */
  results: Map<string, BatchResult<T>>;
  pendingBatches: string[];
}

/** Batch API limits: 100,000 requests or 256 MB per batch; keep a margin. */
const MAX_REQUESTS = 10_000;
const MAX_BYTES = 150 * 1024 * 1024;

export const customIdFor = (key: string): string => {
  const safe = key.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return safe.length <= 64
    ? safe
    : `${safe.slice(0, 47)}-${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBatch<T>(
  ctx: BuildContext,
  name: string,
  task: AiTaskName,
  promptVersion: string,
  jobs: BatchJob[],
): Promise<BatchOutcome<T>> {
  const subsPath = ctx.path('batches', `${name}.json`);
  const resultsPath = ctx.path('batches', `${name}.results.jsonl`);
  if (ctx.opts.force) {
    // --force re-buys the step: earlier batches and results of this name are dropped.
    writeJson(subsPath, []);
    writeJsonl(resultsPath, []);
  }
  const subs = readJsonIf<Submission[]>(subsPath) ?? [];
  const results = new Map<string, BatchResult<T>>();
  for (const r of readJsonl<BatchResult<T>>(resultsPath)) results.set(r.key, r);
  const save = () => {
    writeJson(subsPath, subs);
    writeJsonl(resultsPath, [...results.values()]);
  };

  const collect = async (sub: Submission): Promise<boolean> => {
    const res = await ctx.gateway.collectBatch<T>(sub.batchId);
    if (res.status !== 'ended') {
      const c = res.counts;
      ctx.log(
        `  batch ${sub.batchId}: ${res.status} (${c.succeeded} done, ${c.processing} processing)`,
      );
      return false;
    }
    for (const item of res.items) {
      const key = sub.keys[item.customId] ?? item.customId;
      results.set(key, {
        key,
        ok: item.ok,
        ...(item.ok ? { output: item.output } : { error: item.error ?? 'failed' }),
        batchId: sub.batchId,
        model: sub.model,
      });
    }
    sub.status = 'collected';
    save();
    const failed = res.items.filter((i) => !i.ok).length;
    ctx.log(`  batch ${sub.batchId}: collected ${res.items.length} results (${failed} failed)`);
    return true;
  };

  const pollAll = async () => {
    const deadline = Date.now() + ctx.opts.waitMinutes * 60_000;
    for (;;) {
      const pending = subs.filter((s) => s.status === 'pending');
      for (const sub of pending) await collect(sub);
      if (!subs.some((s) => s.status === 'pending') || Date.now() >= deadline) return;
      await sleep(ctx.opts.pollSeconds * 1000);
    }
  };

  await pollAll();
  if (!subs.some((s) => s.status === 'pending')) {
    const todo = jobs.filter((j) => !results.get(j.key)?.ok);
    if (todo.length > 0) {
      for (const chunk of chunks(todo)) {
        const keys: Record<string, string> = {};
        const items = chunk.map((j) => {
          const customId = customIdFor(j.key);
          keys[customId] = j.key;
          return { ...j.item, customId };
        });
        const submitted = await ctx.gateway.submitBatch(task, promptVersion, items);
        subs.push({
          batchId: submitted.batchId,
          model: submitted.model,
          keys,
          status: 'pending',
          submittedAt: new Date().toISOString(),
        });
        save();
        ctx.log(
          `  submitted batch ${submitted.batchId}: ${items.length} requests (${task}, ${submitted.model})`,
        );
      }
      await pollAll();
    }
  }

  const pendingBatches = subs.filter((s) => s.status === 'pending').map((s) => s.batchId);
  if (pendingBatches.length > 0) {
    ctx.log(
      `  ${pendingBatches.length} batch(es) still running. Re-run the same command to poll and collect.`,
    );
  }
  const complete = pendingBatches.length === 0 && jobs.every((j) => results.get(j.key)?.ok);
  const failed = jobs.filter((j) => results.has(j.key) && !results.get(j.key)!.ok);
  if (pendingBatches.length === 0 && failed.length > 0) {
    ctx.log(
      `  ${failed.length} request(s) failed (${failed
        .slice(0, 3)
        .map((f) => `${f.key}: ${results.get(f.key)!.error}`)
        .join('; ')}). Re-run to resubmit them.`,
    );
  }
  return { complete, results, pendingBatches };
}

function* chunks(jobs: BatchJob[]): Generator<BatchJob[]> {
  let current: BatchJob[] = [];
  let bytes = 0;
  for (const job of jobs) {
    const size =
      JSON.stringify(job.item.input).length +
      (job.item.system?.length ?? 0) +
      (job.item.attachments ?? []).reduce((a, x) => a + x.data.length, 0);
    if (current.length > 0 && (current.length >= MAX_REQUESTS || bytes + size > MAX_BYTES)) {
      yield current;
      current = [];
      bytes = 0;
    }
    current.push(job);
    bytes += size;
  }
  if (current.length > 0) yield current;
}
