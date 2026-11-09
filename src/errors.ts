import { z } from "@hono/zod-openapi";

/**
 * Shared error format for every API: { error: { code, message, request_id, details } }.
 * Error codes are lowercase snake_case (see the integration instruction pack, section 6).
 */
export const ErrorBodySchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "invalid_field" }),
      message: z.string(),
      request_id: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
  })
  .openapi("ErrorBody");

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return { error: { code, message, request_id: requestId, ...(details ? { details } : {}) } };
}
