// Outbox consumer: pgmq "events" → handlers, exactly once per (consumer, event).
// The consumer logic is runtime-neutral and depends only on the EventQueue interface, so it is
// unit-tested in Node with an in-memory queue; PgEventQueue is the real implementation.
import type { Sql, TxSql } from './db.ts';

export interface DomainEvent {
  id: string;
  type: string;
  householdId: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface QueueMessage {
  msgId: number;
  /** Number of times the message has been read, including this read. */
  readCount: number;
  body: { event_id: string; type: string; household_id?: string | null };
}

/** Handlers run inside the transaction that records the processed event and archives the msg. */
export type EventHandler = (event: DomainEvent, tx: TxSql) => Promise<void>;
export type EventHandlers = Record<string, EventHandler>;

export interface EventQueue {
  read(batchSize: number, visibilityTimeoutSec: number): Promise<QueueMessage[]>;
  /** Moves a poisoned message to the dead-letter queue and archives it. */
  deadLetter(message: QueueMessage, reason: string): Promise<void>;
  /**
   * In one transaction: record (consumer, event_id); if new, load the event and run `fn`;
   * archive the message either way. Returns 'duplicate' when the event was already processed.
   */
  processOnce(
    message: QueueMessage,
    consumer: string,
    fn: (event: DomainEvent, tx: TxSql) => Promise<void>,
  ): Promise<'processed' | 'duplicate' | 'missing'>;
}

export interface ConsumeOptions {
  consumer: string;
  batchSize: number;
  visibilityTimeoutSec: number;
  /** After this many failed reads the message goes to `events_dlq`. */
  maxAttempts: number;
  /** Upper bound on batches per invocation (one cron tick). */
  maxBatches: number;
}

export const DEFAULT_CONSUME_OPTIONS: ConsumeOptions = {
  consumer: 'worker',
  batchSize: 20,
  visibilityTimeoutSec: 60,
  maxAttempts: 5,
  maxBatches: 10,
};

export interface ConsumeSummary {
  read: number;
  processed: number;
  duplicates: number;
  deadLettered: number;
  failed: number;
  missing: number;
}

/** Events with no handler are acknowledged (recorded + archived) as no-ops. */
const noop: EventHandler = async () => {};

export async function consumeEvents(
  queue: EventQueue,
  handlers: EventHandlers,
  options: ConsumeOptions = DEFAULT_CONSUME_OPTIONS,
  log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
): Promise<ConsumeSummary> {
  const summary: ConsumeSummary = {
    read: 0,
    processed: 0,
    duplicates: 0,
    deadLettered: 0,
    failed: 0,
    missing: 0,
  };
  for (let batch = 0; batch < options.maxBatches; batch++) {
    const messages = await queue.read(options.batchSize, options.visibilityTimeoutSec);
    if (messages.length === 0) break;
    summary.read += messages.length;
    for (const message of messages) {
      if (message.readCount > options.maxAttempts) {
        await queue.deadLetter(message, `exceeded ${options.maxAttempts} attempts`);
        summary.deadLettered++;
        log('event dead-lettered', { msgId: message.msgId, eventId: message.body.event_id });
        continue;
      }
      try {
        const handler = handlers[message.body.type] ?? noop;
        const outcome = await queue.processOnce(message, options.consumer, handler);
        if (outcome === 'processed') summary.processed++;
        else if (outcome === 'duplicate') summary.duplicates++;
        else summary.missing++;
      } catch (error) {
        // Transaction rolled back: the message becomes visible again after the timeout.
        summary.failed++;
        log('event handler failed', {
          msgId: message.msgId,
          eventId: message.body.event_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (messages.length < options.batchSize) break;
  }
  return summary;
}

interface EventRow {
  id: string;
  type: string;
  household_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export class PgEventQueue implements EventQueue {
  constructor(
    private readonly sql: Sql,
    private readonly queueName = 'events',
    private readonly dlqName = 'events_dlq',
  ) {}

  async read(batchSize: number, visibilityTimeoutSec: number): Promise<QueueMessage[]> {
    const rows = await this.sql<
      { msg_id: string; read_ct: number; message: QueueMessage['body'] }[]
    >`
      select msg_id, read_ct, message
      from pgmq.read(${this.queueName}::text, ${visibilityTimeoutSec}::integer, ${batchSize}::integer)`;
    return rows.map((r) => ({ msgId: Number(r.msg_id), readCount: r.read_ct, body: r.message }));
  }

  async deadLetter(message: QueueMessage, reason: string): Promise<void> {
    const body = { ...message.body, dead_letter_reason: reason, read_count: message.readCount };
    await this.sql.begin(async (tx) => {
      await tx`select pgmq.send(${this.dlqName}::text, ${tx.json(body)}::jsonb)`;
      await tx`select pgmq.archive(${this.queueName}::text, ${message.msgId}::bigint)`;
    });
  }

  async processOnce(
    message: QueueMessage,
    consumer: string,
    fn: (event: DomainEvent, tx: TxSql) => Promise<void>,
  ): Promise<'processed' | 'duplicate' | 'missing'> {
    return (await this.sql.begin(async (tx) => {
      const events = await tx<EventRow[]>`
        select id, type, household_id, aggregate_type, aggregate_id, payload, occurred_at
        from ops.domain_events where id = ${message.body.event_id}`;
      const row = events[0];
      let outcome: 'processed' | 'duplicate' | 'missing';
      if (!row) {
        outcome = 'missing';
      } else {
        const inserted = await tx`
          insert into ops.processed_events (consumer, event_id, msg_id)
          values (${consumer}, ${row.id}, ${message.msgId})
          on conflict (consumer, event_id) do nothing
          returning event_id`;
        if (inserted.length === 0) {
          outcome = 'duplicate';
        } else {
          await fn(
            {
              id: row.id,
              type: row.type,
              householdId: row.household_id,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              payload: row.payload,
              occurredAt: new Date(row.occurred_at).toISOString(),
            },
            tx,
          );
          outcome = 'processed';
        }
      }
      await tx`select pgmq.archive(${this.queueName}::text, ${message.msgId}::bigint)`;
      return outcome;
    })) as 'processed' | 'duplicate' | 'missing';
  }
}
