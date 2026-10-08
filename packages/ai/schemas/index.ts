// JSON Schemas for structured model output (CONTRACT §6). One export per task/prompt family.
// Content-building schemas (page extraction, items, verification) land with X01/M10-M14.

/** Output of the `ai_check` smoke prompt when run in structured mode. */
export const aiCheckOutputSchema = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['OK'] } },
  required: ['status'],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;
