// Runtime-neutral handler for the `worker` function (called by pg_cron via pg_net every minute).
import { ApiError, errorResponse } from '../_shared/errors.ts';
import {
  consumeEvents,
  DEFAULT_CONSUME_OPTIONS,
  type ConsumeOptions,
  type EventHandlers,
  type EventQueue,
} from '../_shared/queue.ts';
import { hasServiceSecret } from '../_shared/secrets.ts';

export interface WorkerDeps {
  serviceSecret: string;
  queue: EventQueue;
  handlers: EventHandlers;
  options?: Partial<ConsumeOptions>;
}

export function createWorkerHandler(deps: WorkerDeps): (request: Request) => Promise<Response> {
  const options = { ...DEFAULT_CONSUME_OPTIONS, ...deps.options };
  return async (request) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    if (request.method !== 'POST') {
      return errorResponse(new ApiError('NOT_FOUND', 'Use POST'), requestId);
    }
    if (!hasServiceSecret(request.headers, deps.serviceSecret)) {
      return errorResponse(new ApiError('UNAUTHENTICATED', 'Service secret required'), requestId);
    }
    const log = (msg: string, extra?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level: 'info', fn: 'worker', requestId, msg, ...extra }));
    const summary = await consumeEvents(deps.queue, deps.handlers, options, log);
    log('tick', { ...summary });
    return Response.json({ requestId, ...summary }, { headers: { 'x-request-id': requestId } });
  };
}
