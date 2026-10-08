import type { ChildCredentials } from '@vionx/contracts/client';

// One-time credentials travel to the credential card screen in memory only (never in route
// params, storage or logs). Reading them clears them.
let pending: (ChildCredentials & { displayName: string }) | null = null;

export function holdCredentials(value: ChildCredentials & { displayName: string }): void {
  pending = value;
}

export function takeCredentials(): (ChildCredentials & { displayName: string }) | null {
  const value = pending;
  pending = null;
  return value;
}
