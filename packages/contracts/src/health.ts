import { z } from '@hono/zod-openapi';

export const HealthCheckSchema = z
  .object({
    ok: z.boolean(),
    /** Critical checks decide the overall status; non-critical ones only warn. */
    critical: z.boolean(),
    latencyMs: z.number().int().nonnegative().optional(),
    detail: z.string().optional(),
  })
  .openapi('HealthCheck');
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    time: z.iso.datetime(),
    requestId: z.string(),
    checks: z.object({
      db: HealthCheckSchema,
      storage: HealthCheckSchema,
      queue: HealthCheckSchema,
      ai: HealthCheckSchema.openapi({
        description: 'ANTHROPIC_API_KEY is configured (no call made).',
      }),
    }),
  })
  .openapi('HealthResponse');
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
