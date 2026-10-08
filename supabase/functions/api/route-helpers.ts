// OpenAPI route helpers shared by the api modules.
import type { z } from '@hono/zod-openapi';
import { ErrorBodySchema, type ErrorCode } from '@vionx/contracts';

export const PARENT = [{ bearerAuth: [] }];
export const CHILD = [{ childSession: [] }];

const ERROR_DESCRIPTIONS: Partial<Record<ErrorCode, [number, string]>> = {
  VALIDATION_FAILED: [400, 'Invalid request (VALIDATION_FAILED)'],
  UNAUTHENTICATED: [401, 'Missing or invalid credentials (UNAUTHENTICATED, INVALID_CREDENTIALS)'],
  FORBIDDEN: [403, 'Not allowed (FORBIDDEN, ACCOUNT_DISABLED, CONSENT_REQUIRED)'],
  CONSENT_REQUIRED: [403, 'Not allowed (FORBIDDEN, ACCOUNT_DISABLED, CONSENT_REQUIRED)'],
  NOT_FOUND: [404, 'Not found, or not in your household (NOT_FOUND)'],
  CONFLICT: [409, 'Conflict (CONFLICT)'],
  ACCOUNT_LOCKED: [423, 'Too many wrong PINs; locked for 15 minutes (ACCOUNT_LOCKED)'],
  RATE_LIMITED: [429, 'Too many attempts (RATE_LIMITED); see Retry-After'],
  SERVICE_UNAVAILABLE: [503, 'A dependency is unavailable (SERVICE_UNAVAILABLE)'],
};

export function errorResponses(...codes: ErrorCode[]) {
  const out: Record<
    number,
    { content: { 'application/json': { schema: typeof ErrorBodySchema } }; description: string }
  > = {};
  for (const code of codes) {
    const [status, description] = ERROR_DESCRIPTIONS[code]!;
    out[status] = { content: { 'application/json': { schema: ErrorBodySchema } }, description };
  }
  return out;
}

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
});

export const body = <T extends z.ZodType>(schema: T, required = true) => ({
  body: { content: { 'application/json': { schema } }, required },
});

export const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
