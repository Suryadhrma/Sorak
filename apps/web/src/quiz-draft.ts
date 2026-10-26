import { DEFAULT_TIME_LIMIT_SEC, MIN_OPTIONS, QuizId, QuizInput, fieldErrors, type QuestionOrigin, type QuizDetail } from "@sorak/shared";
import { z } from "zod";
import { deriveOrigin, type GradedContent } from "./ai-draft.ts";

/**
 * Bentuk form editor. Berbeda dari QuizInput karena form butuh `key` stabil untuk React
 * dan teks kosong (bukan null) untuk kotak isian yang belum diisi.
 */
export type QuestionDraft = {
  key: string;
  id?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  timeLimitSec: number;
  explanation: string;
  origin: QuestionOrigin;
  /**
   * Isi asli soal AI (dari draf, atau dari server kalau origin-nya `ai`). Origin dihitung ulang saat simpan,
   * jadi soal AI yang diubah di editor, termasuk setelah ditambahkan, tercatat `ai_edited`.
   */
  aiSource?: GradedContent;
};

export type QuizDraft = { title: string; description: string; questions: QuestionDraft[] };

export type DraftValidation = { ok: true; input: QuizInput } | { ok: false; fields: Record<string, string> };

export function emptyQuizDraft(): QuizDraft {
  return { title: "", description: "", questions: [newQuestionDraft()] };
}

export function newQuestionDraft(): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    prompt: "",
    options: Array.from({ length: MIN_OPTIONS }, () => ""),
    correctIndex: 0,
    timeLimitSec: DEFAULT_TIME_LIMIT_SEC,
    explanation: "",
    origin: "manual",
  };
}

export function draftFromQuiz(quiz: QuizDetail): QuizDraft {
  return {
    title: quiz.title,
    description: quiz.description ?? "",
    questions: quiz.questions.map((question) => ({
      key: question.id,
      id: question.id,
      prompt: question.prompt,
      options: [...question.options],
      correctIndex: question.correctIndex,
      timeLimitSec: question.timeLimitSec,
      explanation: question.explanation ?? "",
      origin: question.origin,
      ...(question.origin === "ai"
        ? { aiSource: { prompt: question.prompt, options: [...question.options], correctIndex: question.correctIndex } }
        : {}),
    })),
  };
}

const nullIfBlank = (text: string) => (text.trim() === "" ? null : text);

/** Validasi lokal dengan skema yang sama dengan server, supaya guru langsung tahu kotak mana yang salah. */
export function validateDraft(draft: QuizDraft): DraftValidation {
  const result = QuizInput.safeParse({
    title: draft.title,
    description: nullIfBlank(draft.description),
    questions: draft.questions.map((question) => ({
      ...(question.id ? { id: question.id } : {}),
      prompt: question.prompt,
      options: question.options,
      correctIndex: question.correctIndex,
      timeLimitSec: question.timeLimitSec,
      explanation: nullIfBlank(question.explanation),
      origin: question.aiSource ? deriveOrigin(question.aiSource, question) : question.origin,
    })),
  });
  if (result.success) return { ok: true, input: result.data };
  return { ok: false, fields: fieldErrors(result.error.issues) };
}

export function moveQuestion(questions: QuestionDraft[], index: number, delta: -1 | 1): QuestionDraft[] {
  const target = index + delta;
  const current = questions[index];
  const neighbour = questions[target];
  if (!current || !neighbour) return questions;
  const moved = [...questions];
  moved[index] = neighbour;
  moved[target] = current;
  return moved;
}

export function removeOption(question: QuestionDraft, optionIndex: number): QuestionDraft {
  if (question.options.length <= MIN_OPTIONS) return question;
  const options = question.options.filter((_, index) => index !== optionIndex);
  if (question.correctIndex === optionIndex) return { ...question, options, correctIndex: 0 };
  const correctIndex = question.correctIndex > optionIndex ? question.correctIndex - 1 : question.correctIndex;
  return { ...question, options, correctIndex };
}

/** State navigasi editor -> Kuis saya setelah Simpan: kuis mana yang baru disimpan (untuk pesan dan sorotan baris). */
export const SavedQuizState = z.object({ savedQuizId: QuizId });
export type SavedQuizState = z.infer<typeof SavedQuizState>;
