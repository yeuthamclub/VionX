export type AiErrorCode =
  | 'AI_TASK_DISABLED'
  | 'AI_REFUSED'
  | 'AI_MAX_TOKENS'
  | 'AI_INVALID_OUTPUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_UNKNOWN_BATCH'
  | 'AI_UNKNOWN_TASK';

export class AiError extends Error {
  override readonly name = 'AiError';
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
