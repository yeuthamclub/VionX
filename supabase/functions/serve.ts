// Development server (ADR-002): the three Edge Functions on one port of this machine, talking to the
// Supabase Cloud project of `.env.cloud`. Replaces `supabase functions serve`, which needs Docker.
// Start with `pnpm fn:serve`; routes are the hosted ones (`/functions/v1/<function>/...`).
import { createGateway } from './_shared/ai.ts';
import { getSql } from './_shared/db.ts';
import { readEnv } from './_shared/env.ts';
import { OutboxPushNotifier } from './_shared/notify.ts';
import { PgEventQueue } from './_shared/queue.ts';
import { SupabaseStorage } from './_shared/storage.ts';
import { createAiBatchHandler } from './ai-batch/app.ts';
import { createApp } from './api/app.ts';
import { liveDeps } from './api/live-deps.ts';
import { createWorkerHandler } from './worker/app.ts';
import { createHandlers } from './worker/handlers.ts';
import { expireExports } from './worker/privacy-export.ts';
import { removeOrphanAssessmentFiles, removeOrphanProofs } from './worker/task-proofs.ts';

const env = readEnv((name) => Deno.env.get(name));
const sql = getSql(env.dbUrl);
const storage = new SupabaseStorage({
  url: env.supabaseUrl,
  serviceRoleKey: env.serviceRoleKey,
  publicUrl: env.publicSupabaseUrl,
});
const api = createApp(liveDeps(env));
const worker = createWorkerHandler({
  serviceSecret: env.serviceSecret,
  queue: new PgEventQueue(sql),
  handlers: createHandlers({ storage, notifier: new OutboxPushNotifier() }),
  maintenance: async () => ({
    expiredExports: await expireExports(sql, storage),
    removedOrphanProofs: await removeOrphanProofs(sql, storage),
    removedOrphanAssessmentFiles: await removeOrphanAssessmentFiles(sql, storage),
  }),
});
const aiBatch = createAiBatchHandler({
  serviceSecret: env.serviceSecret,
  gateway: createGateway(sql, env.anthropicApiKey),
});

const PREFIX = '/functions/v1';
Deno.serve({ port: Number(Deno.env.get('PORT') ?? 54331), hostname: '0.0.0.0' }, (req) => {
  const url = new URL(req.url);
  const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : '';
  if (path === '/worker' || path.startsWith('/worker/')) return worker(req);
  if (path === '/ai-batch' || path.startsWith('/ai-batch/')) return aiBatch(req);
  if (path.startsWith('/api/')) {
    // The hosted runtime hands the function a path that starts with its own name.
    url.pathname = path;
    return api.fetch(new Request(url, req));
  }
  return new Response('not found', { status: 404 });
});
