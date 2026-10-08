// Deno entrypoint for the `api` Edge Function.
import { readEnv } from '../_shared/env.ts';
import { createApp } from './app.ts';
import { liveDeps } from './live-deps.ts';

const app = createApp(liveDeps(readEnv((name) => Deno.env.get(name))));

Deno.serve(app.fetch);
