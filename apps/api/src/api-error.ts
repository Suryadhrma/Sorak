import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError, ApiErrorCode } from "@sorak/shared";

/** `details`: `fields` untuk VALIDATION_FAILED, `retryAfterSec` untuk AI_RATE_LIMITED. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  details: Omit<ApiError["error"], "code" | "message"> = {},
) {
  const body: ApiError = { error: { code, message, ...details } };
  return c.json(body, status);
}
