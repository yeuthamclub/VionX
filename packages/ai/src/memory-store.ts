import type { AiRunRecord, AiRunStore, BatchInfo } from './types.ts';

/** In-memory ai_runs store for tests and local scripts. */
export class MemoryAiRunStore implements AiRunStore {
  readonly records: AiRunRecord[] = [];

  async log(record: AiRunRecord): Promise<void> {
    this.records.push(record);
  }

  async findBatch(batchId: string): Promise<BatchInfo | null> {
    const row = this.records.find((r) => r.batchId === batchId && r.status === 'batch_submitted');
    return row ? { task: row.task, promptVersion: row.promptVersion, model: row.model } : null;
  }
}
