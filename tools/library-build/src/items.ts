// The run's items: one record per planned slot (latest attempt) in items.jsonl; earlier attempts
// move to items-history.jsonl (rejection rate, lessons for the next run).
import { appendFileSync } from 'node:fs';
import type { ItemTemplate, PackageItem } from '@vionx/domain';
import type { BuildContext } from './context.ts';
import type { CheckResult } from './lib/checks.ts';
import { readJsonl, writeJsonl } from './lib/jsonl.ts';

export interface VerifyRecord {
  answerJson: string | null;
  agree: boolean;
  solvable: boolean;
  hintsOk: boolean;
  ageAppropriate: boolean;
  issues: string[];
  note: string;
}

export interface DisputeRecord {
  verdict: 'KEY_CORRECT' | 'KEY_WRONG' | 'AMBIGUOUS';
  correctAnswerJson: string | null;
  note: string;
}

export interface ReviewRecord {
  verdict: 'APPROVED' | 'REJECTED' | 'EDITED';
  note: string;
  by: string;
  at: string;
}

export interface ItemRecord {
  slot: string;
  attempt: number;
  item: PackageItem;
  template?: ItemTemplate;
  /** Why the item is REJECTED (check names, review note). */
  rejectedFor?: string[];
  checks?: CheckResult[];
  verify?: VerifyRecord;
  dispute?: DisputeRecord;
  review?: ReviewRecord;
}

/** Regeneration rule: a rejected slot gets one more attempt (TASK_PACKS/X01.md step 11). */
export const MAX_ATTEMPTS = 2;

export class ItemStore {
  readonly records: Map<string, ItemRecord>;

  constructor(private readonly ctx: BuildContext) {
    this.records = new Map(readJsonl<ItemRecord>(ctx.path('items.jsonl')).map((r) => [r.slot, r]));
  }

  get(slot: string) {
    return this.records.get(slot);
  }

  /** Replaces a slot's record; the previous attempt goes to the history file. */
  put(record: ItemRecord): void {
    const previous = this.records.get(record.slot);
    if (previous && previous.attempt !== record.attempt) {
      appendFileSync(this.ctx.path('items-history.jsonl'), `${JSON.stringify(previous)}\n`);
    }
    this.records.set(record.slot, record);
  }

  list(filter: (r: ItemRecord) => boolean = () => true): ItemRecord[] {
    return [...this.records.values()].filter(filter).sort((a, b) => a.slot.localeCompare(b.slot));
  }

  save(): void {
    writeJsonl(this.ctx.path('items.jsonl'), this.list());
  }

  history(): ItemRecord[] {
    return readJsonl<ItemRecord>(this.ctx.path('items-history.jsonl'));
  }
}

export function reject(record: ItemRecord, reasons: string[]): void {
  record.item.status = 'REJECTED';
  record.rejectedFor = reasons;
}
