// Deno entrypoint for the `worker` Edge Function.
import { getSql } from '../_shared/db.ts';
import { readEnv } from '../_shared/env.ts';
import { PgEventQueue } from '../_shared/queue.ts';
import { createWorkerHandler } from './app.ts';
import { handlers } from './handlers.ts';

const env = readEnv((name) => Deno.env.get(name));

Deno.serve(
  createWorkerHandler({
    serviceSecret: env.serviceSecret,
    queue: new PgEventQueue(getSql(env.dbUrl)),
    handlers,
  }),
);
