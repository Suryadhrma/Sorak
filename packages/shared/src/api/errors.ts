import { z } from "zod";

/** Kode error REST. Terpisah dari ErrorCode WebSocket karena kliennya berbeda. */
export const ApiErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "ROOM_FULL",
  "GAME_ALREADY_STARTED",
  "INTERNAL",
  // Draf soal AI (Hari 6). Editor manual tidak pernah terblokir oleh kode-kode ini.
  "AI_UNAVAILABLE",
  "AI_QUOTA_EXCEEDED",
  "AI_RATE_LIMITED",
  "AI_INVALID_OUTPUT",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    /** Hanya untuk VALIDATION_FAILED: path Zod (`questions.3.correctIndex`) ke pesan, untuk menandai kotak di editor. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Hanya untuk AI_RATE_LIMITED: detik sampai boleh mencoba lagi (dari header retry-after Groq). */
    retryAfterSec: z.number().int().positive().optional(),
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
