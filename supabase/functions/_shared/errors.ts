import type { ErrorBody, ErrorCode } from '@vionx/contracts';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_HOUSEHOLD: 403,
  CONSENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REWARD_CAP_REACHED: 409,
  TUTOR_QUOTA_REACHED: 429,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
};

/** Throw from any handler; the error handler renders `{code, message, details?, requestId}`. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    /** Extra response headers, e.g. `retry-after` for RATE_LIMITED. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function errorBody(error: ApiError, requestId: string): ErrorBody {
  const body: ErrorBody = { code: error.code, message: error.message, requestId };
  if (error.details !== undefined) body.details = error.details;
  return body;
}

/** JSON response helper for plain (non-Hono) handlers such as the worker. */
export function errorResponse(error: ApiError, requestId: string): Response {
  return Response.json(errorBody(error, requestId), {
    status: error.status,
    headers: { 'x-request-id': requestId },
  });
}
