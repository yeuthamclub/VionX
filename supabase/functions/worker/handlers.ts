import type { EventHandlers } from '../_shared/queue.ts';

/**
 * Event type → handler. Modules register their consumers here (reward conversion, Today
 * regeneration, notifications, exports, AI batch polling...). Unknown types are acknowledged
 * as no-ops so the queue never backs up on events nobody consumes yet.
 */
export const handlers: EventHandlers = {
  // Smoke event used by the M00 acceptance script; consuming it has no side effects.
  'system.ping': async () => {},
};
