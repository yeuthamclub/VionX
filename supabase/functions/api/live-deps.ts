import {
  LiveActorResolver,
  PgAdminPermissionStore,
  PgChildSessionStore,
} from '../_shared/actor.ts';
import { getSql } from '../_shared/db.ts';
import type { FunctionEnv } from '../_shared/env.ts';
import { SupabaseJwtVerifier } from '../_shared/jwt.ts';
import { SupabaseStorage } from '../_shared/storage.ts';
import type { ApiDeps } from './deps.ts';
import { pendingAccountDeletion } from './privacy/repo.ts';

/** Real dependencies for the deployed function (Deno) built from env. */
export function liveDeps(env: FunctionEnv): ApiDeps {
  const sql = getSql(env.dbUrl);
  return {
    version: env.appVersion,
    allowedOrigins: env.allowedOrigins,
    sql,
    admins: new PgAdminPermissionStore(sql),
    accountDeletions: { pending: (userId) => pendingAccountDeletion(sql, userId) },
    storage: new SupabaseStorage({
      url: env.supabaseUrl,
      serviceRoleKey: env.serviceRoleKey,
      publicUrl: env.publicSupabaseUrl,
    }),
    actors: new LiveActorResolver({
      serviceSecret: env.serviceSecret,
      parentTokens: new SupabaseJwtVerifier({
        jwksUrl: env.jwksUrl,
        ...(env.jwtSecret ? { legacySecret: env.jwtSecret } : {}),
      }),
      childSessions: new PgChildSessionStore(sql),
    }),
    probes: {
      db: async () => {
        await sql`select 1`;
      },
      storage: async () => {
        const res = await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
          headers: {
            apikey: env.serviceRoleKey,
            authorization: `Bearer ${env.serviceRoleKey}`,
          },
        });
        await res.body?.cancel();
        if (!res.ok) throw new Error(`storage responded ${res.status}`);
      },
      queue: async () => {
        const rows = await sql<{ queue_length: string }[]>`
          select queue_length from pgmq.metrics('events')`;
        return `events queue length ${rows[0]?.queue_length ?? 'unknown'}`;
      },
      aiKeyPresent: Boolean(env.anthropicApiKey),
    },
  };
}
