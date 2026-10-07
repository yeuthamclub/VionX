import { z } from '@hono/zod-openapi';

/** Stable API error codes (CONTRACT §4). Add codes; never rename or reuse them. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'FORBIDDEN_HOUSEHOLD',
  'NOT_FOUND',
  'CONFLICT',
  'CONSENT_REQUIRED',
  'REWARD_CAP_REACHED',
  'TUTOR_QUOTA_REACHED',
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorBodySchema = z
  .object({
    code: z.enum(ERROR_CODES).openapi({ example: 'VALIDATION_FAILED' }),
    message: z.string().openapi({ example: 'Request body is invalid' }),
    details: z.unknown().optional(),
    requestId: z.string().openapi({ example: 'a1b2c3d4-...' }),
  })
  .openapi('Error');
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
