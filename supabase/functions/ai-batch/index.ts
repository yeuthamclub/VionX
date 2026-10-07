// Deno entrypoint for the `ai-batch` Edge Function.
import { createGateway } from '../_shared/ai.ts';
import { getSql } from '../_shared/db.ts';
import { readEnv } from '../_shared/env.ts';
import { createAiBatchHandler } from './app.ts';

const env = readEnv((name) => Deno.env.get(name));

Deno.serve(
  createAiBatchHandler({
    serviceSecret: env.serviceSecret,
    gateway: createGateway(getSql(env.dbUrl), env.anthropicApiKey),
  }),
);
