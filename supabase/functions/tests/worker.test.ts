import { describe, expect, it, vi } from 'vitest';
import type { TxSql } from '../_shared/db.ts';
import {
  consumeEvents,
  DEFAULT_CONSUME_OPTIONS,
  type DomainEvent,
  type EventQueue,
  type QueueMessage,
} from '../_shared/queue.ts';
import { createWorkerHandler } from '../worker/app.ts';

/**
 * In-memory pgmq + processed_events model. A failed handler leaves the message in the queue
 * (visibility timeout elapses immediately here), like a rolled-back transaction.
 */
class MemoryQueue implements EventQueue {
  messages: QueueMessage[] = [];
  archived: number[] = [];
  dlq: QueueMessage[] = [];
  processed = new Set<string>();
  events = new Map<string, DomainEvent>();
  private seq = 0;

  publish(type: string, id = `evt-${this.seq + 1}`): string {
    this.events.set(id, {
      id,
      type,
      householdId: null,
      aggregateType: null,
      aggregateId: null,
      payload: {},
      occurredAt: new Date(0).toISOString(),
    });
    this.messages.push({ msgId: ++this.seq, readCount: 0, body: { event_id: id, type } });
    return id;
  }

  /** Simulates pgmq delivering the same event twice (e.g. a duplicate send). */
  redeliver(eventId: string, type: string): void {
    this.messages.push({ msgId: ++this.seq, readCount: 0, body: { event_id: eventId, type } });
  }

  async read(batchSize: number): Promise<QueueMessage[]> {
    const batch = this.messages.slice(0, batchSize);
    for (const m of batch) m.readCount++;
    return batch.map((m) => ({ ...m }));
  }

  async deadLetter(message: QueueMessage): Promise<void> {
    this.dlq.push(message);
    this.archive(message.msgId);
  }

  async processOnce(
    message: QueueMessage,
    consumer: string,
    fn: (event: DomainEvent, tx: TxSql) => Promise<void>,
  ): Promise<'processed' | 'duplicate' | 'missing'> {
    const event = this.events.get(message.body.event_id);
    const key = `${consumer}:${message.body.event_id}`;
    let outcome: 'processed' | 'duplicate' | 'missing';
    if (!event) outcome = 'missing';
    else if (this.processed.has(key)) outcome = 'duplicate';
    else {
      await fn(event, {} as TxSql); // throws → nothing recorded, message stays
      this.processed.add(key);
      outcome = 'processed';
    }
    this.archive(message.msgId);
    return outcome;
  }

  private archive(msgId: number): void {
    this.archived.push(msgId);
    this.messages = this.messages.filter((m) => m.msgId !== msgId);
  }
}

describe('consumeEvents', () => {
  it('processes each event exactly once even when delivered twice', async () => {
    const queue = new MemoryQueue();
    const seen: string[] = [];
    const id = queue.publish('system.ping');
    queue.redeliver(id, 'system.ping');
    const summary = await consumeEvents(queue, {
      'system.ping': async (event) => {
        seen.push(event.id);
      },
    });
    expect(seen).toEqual([id]);
    expect(summary).toMatchObject({ read: 2, processed: 1, duplicates: 1 });
    expect(queue.messages).toHaveLength(0);

    // A second tick finds nothing.
    expect(await consumeEvents(queue, {})).toMatchObject({ read: 0, processed: 0 });
  });

  it('acknowledges events without a handler', async () => {
    const queue = new MemoryQueue();
    queue.publish('unknown.event');
    expect(await consumeEvents(queue, {})).toMatchObject({ processed: 1 });
  });

  it('retries failures and dead-letters after maxAttempts', async () => {
    const queue = new MemoryQueue();
    queue.publish('flaky.event');
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    const options = { ...DEFAULT_CONSUME_OPTIONS, maxAttempts: 3, maxBatches: 1 };
    for (let tick = 0; tick < 3; tick++) {
      expect(await consumeEvents(queue, { 'flaky.event': handler }, options)).toMatchObject({
        failed: 1,
      });
    }
    const last = await consumeEvents(queue, { 'flaky.event': handler }, options);
    expect(last).toMatchObject({ deadLettered: 1, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.dlq).toHaveLength(1);
    expect(queue.messages).toHaveLength(0);
  });

  it('drains multiple batches per tick', async () => {
    const queue = new MemoryQueue();
    for (let i = 0; i < 5; i++) queue.publish('system.ping');
    const summary = await consumeEvents(queue, {}, { ...DEFAULT_CONSUME_OPTIONS, batchSize: 2 });
    expect(summary).toMatchObject({ read: 5, processed: 5 });
  });
});

describe('worker handler', () => {
  const handler = createWorkerHandler({
    serviceSecret: 's3cret',
    queue: new MemoryQueue(),
    handlers: {},
  });

  it('requires the service secret', async () => {
    const res = await handler(new Request('http://local/worker', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns the tick summary', async () => {
    const res = await handler(
      new Request('http://local/worker', {
        method: 'POST',
        headers: { 'x-vionx-service-secret': 's3cret' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ read: 0, processed: 0 });
  });
});
