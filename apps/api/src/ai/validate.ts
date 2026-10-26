import { z } from "zod";
import { AI_EVIDENCE_MAX_CHARS, AiDraftQuestion, normalizeText, type AiDraft } from "@sorak/shared";
import { isGrounded } from "./grounding.ts";

export type DraftFailure = "invalid_json" | "invalid_schema" | "wrong_count" | "duplicate_prompt";
export type ParsedDrafts = { ok: true; drafts: AiDraft[] } | { ok: false; reason: DraftFailure; detail: string };

/**
 * Bukti yang terlalu panjang dipotong sebelum validasi, bukan menggagalkan seluruh generate: potongan awal kutipan
 * tetap kutipan (grounding check tetap berlaku), dan Structured Outputs tidak bisa membatasi panjang string.
 */
const DraftOutput = z.object({
  questions: z.array(
    z.preprocess((value) => {
      if (typeof value !== "object" || value === null || !("evidence" in value) || typeof value.evidence !== "string") return value;
      return { ...value, evidence: value.evidence.trim().slice(0, AI_EVIDENCE_MAX_CHARS) };
    }, AiDraftQuestion),
  ),
});

/** Output mentah Groq (isi message.content) jadi daftar draf bertanda grounded, atau alasan gagal. */
export function parseDrafts(raw: string, { count, sourceText }: { count: number; sourceText: string }): ParsedDrafts {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid_json", detail: String(error) };
  }

  const parsed = DraftOutput.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return { ok: false, reason: "invalid_schema", detail };
  }

  const { questions } = parsed.data;
  if (questions.length !== count) {
    return { ok: false, reason: "wrong_count", detail: `diminta ${count}, didapat ${questions.length}` };
  }
  const prompts = new Set(questions.map((question) => normalizeText(question.prompt)));
  if (prompts.size !== questions.length) return { ok: false, reason: "duplicate_prompt", detail: "ada soal yang sama" };

  return { ok: true, drafts: questions.map((question) => ({ ...question, grounded: isGrounded(question.evidence, sourceText) })) };
}
