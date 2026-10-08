/** Result type for rules that can fail with a stable, user-facing error code. */
export type Result<T, E extends string = string> =
  { ok: true; value: T } | { ok: false; error: E; message?: string };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E extends string>(error: E, message?: string): Result<never, E> =>
  message === undefined ? { ok: false, error } : { ok: false, error, message };
