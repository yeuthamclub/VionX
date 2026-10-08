// Deno entrypoint for the `worker` Edge Function.
import { getSql } from '../_shared/db.ts';
import { readEnv } from '../_shared/env.ts';
import { OutboxPushNotifier } from '../_shared/notify.ts';
import { PgEventQueue } from '../_shared/queue.ts';
import { SupabaseStorage } from '../_shared/storage.ts';
import { createWorkerHandler } from './app.ts';
import { createHandlers } from './handlers.ts';
import { expireExports } from './privacy-export.ts';

const env = readEnv((name) => Deno.env.get(name));
const sql = getSql(env.dbUrl);
const storage = new SupabaseStorage({
  url: env.supabaseUrl,
  serviceRoleKey: env.serviceRoleKey,
  publicUrl: env.publicSupabaseUrl,
});

Deno.serve(
  createWorkerHandler({
    serviceSecret: env.serviceSecret,
    queue: new PgEventQueue(sql),
    handlers: createHandlers({ storage, notifier: new OutboxPushNotifier() }),
    maintenance: async () => ({ expiredExports: await expireExports(sql, storage) }),
  }),
);
