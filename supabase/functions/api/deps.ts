import type { ActorResolver } from '../_shared/actor.ts';

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
  /** Browser origins allowed by CORS (admin SPA). */
  allowedOrigins: string[];
  /** Per-probe timeout. */
  probeTimeoutMs?: number;
}
