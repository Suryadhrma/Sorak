import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError, ApiErrorCode } from "@sorak/shared";

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
) {
  const body: ApiError = { error: fields ? { code, message, fields } : { code, message } };
  return c.json(body, status);
}
