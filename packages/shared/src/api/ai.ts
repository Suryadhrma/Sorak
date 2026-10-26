import { z } from "zod";
import {
  AI_EVIDENCE_MAX_CHARS,
  AI_EXPLANATION_MAX_CHARS,
  AI_OPTION_COUNT,
  AI_QUESTION_COUNTS,
  AI_SOURCE_MAX_CHARS,
  AI_SOURCE_MIN_CHARS,
  OPTION_MAX_LENGTH,
} from "../constants.ts";
import { ChoiceIndex, Prompt } from "../primitives.ts";

/**
 * Draf soal AI dari teks materi (Hari 6, F-10). Output model selalu divalidasi skema ini di server, walau Groq
 * Structured Outputs (strict) sudah membatasi bentuknya: data dari luar tidak dipercaya, termasuk dari AI.
 */

/**
 * Bentuk pembanding teks: NFKC, huruf kecil, tanda kutip lengkung jadi lurus, spasi beruntun jadi satu.
 * Dipakai untuk pilihan kembar, soal kembar, dan grounding check (bukti ada di materi).
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export const AiGenerateFromTextInput = z.object({
  sourceText: z
    .string()
    .trim()
    .min(AI_SOURCE_MIN_CHARS, `Materi minimal ${AI_SOURCE_MIN_CHARS} huruf`)
    .max(AI_SOURCE_MAX_CHARS, `Materi maksimal ${AI_SOURCE_MAX_CHARS} huruf`),
  count: z.literal(AI_QUESTION_COUNTS),
});
export type AiGenerateFromTextInput = z.infer<typeof AiGenerateFromTextInput>;

const AiOption = z.string().trim().min(1).max(OPTION_MAX_LENGTH);

export const AiDraftQuestion = z.object({
  prompt: z.string().trim().pipe(Prompt),
  options: z
    .array(AiOption)
    .length(AI_OPTION_COUNT)
    .refine((options) => new Set(options.map(normalizeText)).size === options.length, "Ada pilihan yang kembar"),
  correctIndex: ChoiceIndex,
  explanation: z.string().trim().max(AI_EXPLANATION_MAX_CHARS),
  evidence: z.string().trim().max(AI_EVIDENCE_MAX_CHARS),
});
export type AiDraftQuestion = z.infer<typeof AiDraftQuestion>;

/** grounded: bukti benar-benar ada di materi (grounding check di server); kalau tidak, guru diminta memeriksa. */
export const AiDraft = AiDraftQuestion.extend({ grounded: z.boolean() });
export type AiDraft = z.infer<typeof AiDraft>;

export const AiDraftResponse = z.object({
  drafts: z.array(AiDraft),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});
export type AiDraftResponse = z.infer<typeof AiDraftResponse>;
