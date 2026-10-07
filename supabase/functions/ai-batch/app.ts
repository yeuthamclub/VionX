// Runtime-neutral handler for the `ai-batch` function. M00 stub: submits and collects batches
// through AiGateway; X01/M10 add the content-building callers and cron polling.
import { AI_TASKS, AiError, type AiGateway } from '@vionx/ai';
import { z } from 'zod';
import { ApiError, errorResponse } from '../_shared/errors.ts';
import { hasServiceSecret } from '../_shared/secrets.ts';

const BatchRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit'),
    task: z.enum(AI_TASKS),
    promptVersion: z.string().min(1),
    system: z.string().optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    items: z
      .array(
        z.object({
          customId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          input: z.union([z.string(), z.record(z.string(), z.unknown())]),
          sourceRefs: z.array(z.string()).optional(),
        }),
      )
      .min(1)
      .max(10_000),
  }),
  z.object({ action: z.literal('collect'), batchId: z.string().min(1) }),
]);

export interface AiBatchDeps {
  serviceSecret: string;
  gateway: AiGateway;
}

export function createAiBatchHandler(deps: AiBatchDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    try {
      if (request.method !== 'POST') throw new ApiError('NOT_FOUND', 'Use POST');
      if (!hasServiceSecret(request.headers, deps.serviceSecret)) {
        throw new ApiError('UNAUTHENTICATED', 'Service secret required');
      }
      const parsed = BatchRequestSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        throw new ApiError('VALIDATION_FAILED', 'Invalid batch request', parsed.error.issues);
      }
      const body = parsed.data;
      const result =
        body.action === 'submit'
          ? await deps.gateway.submitBatch(
              body.task,
              body.promptVersion,
              body.items.map((item) => ({
                ...item,
                ...(body.system !== undefined ? { system: body.system } : {}),
                ...(body.outputSchema !== undefined ? { outputSchema: body.outputSchema } : {}),
              })),
            )
          : await deps.gateway.collectBatch(body.batchId);
      return Response.json({ requestId, ...result }, { headers: { 'x-request-id': requestId } });
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId);
      if (error instanceof AiError) {
        const code = error.code === 'AI_UNKNOWN_BATCH' ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE';
        return errorResponse(new ApiError(code, error.message, { aiCode: error.code }), requestId);
      }
      console.error(
        JSON.stringify({ level: 'error', fn: 'ai-batch', requestId, error: String(error) }),
      );
      return errorResponse(new ApiError('INTERNAL', 'Internal error'), requestId);
    }
  };
}
