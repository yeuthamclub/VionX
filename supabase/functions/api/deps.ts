import type { ActorResolver, AdminPermissionStore } from '../_shared/actor.ts';
import type { Sql } from '../_shared/db.ts';
import type { ObjectStorage } from '../_shared/storage.ts';

/** A probe resolves (optionally with a detail string) when healthy and throws otherwise. */
export type Probe = () => Promise<string | void>;

export interface HealthProbes {
  db: Probe;
  storage: Probe;
  queue: Probe;
  aiKeyPresent: boolean;
}

/** Everything the api app needs from the outside world. Tests pass fakes. */
export interface ApiDeps {
  version: string;
  probes: HealthProbes;
  actors: ActorResolver;
  /** Database (role postgres via SUPABASE_DB_URL); child data only through `scoped()`. */
  sql: Sql;
  admins: AdminPermissionStore;
  /** Private Storage (signed export links). Optional for tooling; routes answer 503 without it. */
  storage?: ObjectStorage;
  /** Browser origins allowed by CORS (admin SPA). */
  allowedOrigins: string[];
  /** Per-probe timeout. */
  probeTimeoutMs?: number;
  /** Clock override for tests. */
  now?: () => Date;
}

/** For tooling and unit tests that never reach the database. */
export const noDatabase: Sql = new Proxy((() => {}) as unknown as Sql, {
  get: () => {
    throw new Error('No database in this context');
  },
  apply: () => {
    throw new Error('No database in this context');
  },
});
