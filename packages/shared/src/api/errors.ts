import { z } from "zod";

/** Kode error REST. Terpisah dari ErrorCode WebSocket karena kliennya berbeda. */
export const ApiErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "ROOM_FULL",
  "GAME_ALREADY_STARTED",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    /** Hanya untuk VALIDATION_FAILED: path Zod (`questions.3.correctIndex`) ke pesan, untuk menandai kotak di editor. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Issue Zod jadi `fields` ApiError: path bertitik (`questions.3.correctIndex`) ke pesan pertama di path itu. */
export function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    // Satu kotak cukup satu pesan; yang pertama biasanya yang paling mendasar.
    fields[path] ??= issue.message;
  }
  return fields;
}
