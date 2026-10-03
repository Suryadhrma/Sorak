import { z } from "zod";

/** Kode error REST. Terpisah dari ErrorCode WebSocket karena kliennya berbeda. */
export const ApiErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
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
