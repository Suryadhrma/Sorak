import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  AI_DAILY_LIMIT_PER_HOST,
  AI_PROMPT_VERSION,
  AI_SOURCE_MAX_CHARS,
  AiGenerateFromTextInput,
  fieldErrors,
  type AiDraftResponse,
  type Host,
} from "@sorak/shared";
import { readAiConfig } from "./ai/config.ts";
import { recordGeneration, type Generation } from "./ai/generations.ts";
import { callGroq } from "./ai/groq.ts";
import { buildTextPrompt } from "./ai/prompt.ts";
import { generationsSince, wibDayStart } from "./ai/quota.ts";
import { parseDrafts } from "./ai/validate.ts";
import { apiError } from "./api-error.ts";
import { log } from "./log.ts";
import { requireHost } from "./session.ts";

type AiEnv = { Bindings: Env; Variables: { host: Host } };

export const aiRoutes = new Hono<AiEnv>();

aiRoutes.use("*", requireHost);

// Materi maksimal AI_SOURCE_MAX_CHARS huruf; satu huruf UTF-8 paling banyak 4 byte, ditambah ruang untuk JSON-nya.
const generateBodyLimit = bodyLimit({
  maxSize: AI_SOURCE_MAX_CHARS * 4 + 1024,
  onError: (c) => apiError(c, 413, "PAYLOAD_TOO_LARGE", "Materi terlalu panjang"),
});

const UNAVAILABLE_MESSAGE = "Fitur AI sedang tidak tersedia. Kamu tetap bisa membuat soal manual.";

/**
 * Membuat draf soal dari teks materi. Draf tidak disimpan ke kuis: soal baru masuk kuis setelah guru
 * menyetujuinya lewat PUT /api/quizzes/:id (acceptance criteria F-10).
 */
aiRoutes.post("/generate", generateBodyLimit, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) return apiError(c, 400, "VALIDATION_FAILED", "Body bukan JSON yang valid");
    throw error;
  }
  const input = AiGenerateFromTextInput.safeParse(body);
  if (!input.success) {
    return apiError(c, 400, "VALIDATION_FAILED", "Materi belum valid", { fields: fieldErrors(input.error.issues) });
  }

  const config = readAiConfig(c.env);
  if (!config) return apiError(c, 503, "AI_UNAVAILABLE", UNAVAILABLE_MESSAGE);

  const db = c.env.DB;
  const now = Date.now();
  const base = { hostId: c.var.host.id, model: config.GROQ_TEXT_MODEL, promptVersion: AI_PROMPT_VERSION, createdAt: now };
  const record = async (generation: Omit<Generation, keyof typeof base>, logFields: Record<string, unknown> = {}) => {
    await recordGeneration(db, { ...base, ...generation });
    log.info("ai_generate", {
      status: generation.status,
      model: base.model,
      promptVersion: base.promptVersion,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      latencyMs: generation.latencyMs,
      grounded: generation.groundedCount,
      total: generation.questionsCount,
      ...logFields,
    });
  };
  const noUsage = { questionsCount: 0, groundedCount: null, inputTokens: null, outputTokens: null };

  if ((await generationsSince(db, c.var.host.id, wibDayStart(now))) >= AI_DAILY_LIMIT_PER_HOST) {
    await record({ status: "quota_exceeded", ...noUsage, latencyMs: null });
    return apiError(c, 429, "AI_QUOTA_EXCEEDED", "Jatah AI hari ini habis. Coba lagi besok.");
  }

  const startedAt = Date.now();
  const result = await callGroq({ apiKey: config.GROQ_API_KEY, model: config.GROQ_TEXT_MODEL }, buildTextPrompt(input.data));
  const latencyMs = Date.now() - startedAt;

  if (result.kind === "rate_limited") {
    await record({ status: "provider_error", ...noUsage, latencyMs }, { reason: "rate_limited" });
    return apiError(c, 429, "AI_RATE_LIMITED", "Server AI sedang sibuk. Coba lagi sebentar lagi.", {
      retryAfterSec: result.retryAfterSec,
    });
  }
  if (result.kind === "failed") {
    await record({ status: "provider_error", ...noUsage, latencyMs }, { reason: result.reason });
    return apiError(c, 503, "AI_UNAVAILABLE", UNAVAILABLE_MESSAGE);
  }

  const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, latencyMs };
  const parsed = parseDrafts(result.content, input.data);
  if (!parsed.ok) {
    // `detail` berisi path dan pesan Zod (tanpa isi soal), cukup untuk tahu bagian mana yang sering gagal.
    await record(
      { status: "invalid_schema", questionsCount: 0, groundedCount: null, ...usage },
      { reason: parsed.reason, detail: parsed.detail },
    );
    return apiError(c, 502, "AI_INVALID_OUTPUT", "AI mengembalikan soal yang tidak valid. Coba lagi.");
  }

  const groundedCount = parsed.drafts.filter((draft) => draft.grounded).length;
  await record({ status: "ok", questionsCount: parsed.drafts.length, groundedCount, ...usage });
  const response: AiDraftResponse = { drafts: parsed.drafts, model: config.GROQ_TEXT_MODEL, promptVersion: AI_PROMPT_VERSION };
  return c.json(response);
});
