// Parent notifications. Real FCM push arrives in M09; until then the notifier records a
// `notification.push_requested` event in the outbox (same transaction as the state change), which
// the M09 push sender will consume.
import type { TxSql } from './db.ts';

export interface ParentNotification {
  userId: string;
  householdId: string;
  kind: 'privacy.export_ready';
  /** Small, non-sensitive payload for the app to route the tap (ids only). */
  data: Record<string, string>;
  /** One notification per key (e.g. per export job), however often the caller retries. */
  idempotencyKey: string;
}

export interface ParentNotifier {
  notify(tx: TxSql, notification: ParentNotification): Promise<void>;
}

export class OutboxPushNotifier implements ParentNotifier {
  async notify(tx: TxSql, n: ParentNotification): Promise<void> {
    await tx`
      insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
      values ('notification.push_requested', ${n.householdId}, 'user', ${n.userId},
              ${tx.json({ channel: 'push', userId: n.userId, kind: n.kind, data: n.data } as never)},
              ${n.idempotencyKey})
      on conflict do nothing`;
  }
}
