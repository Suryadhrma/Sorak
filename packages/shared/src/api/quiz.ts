import { z } from "zod";
import {
  EXPLANATION_MAX_LENGTH,
  MAX_QUESTIONS_PER_QUIZ,
  QUIZ_DESCRIPTION_MAX_LENGTH,
  QUIZ_TITLE_MAX_LENGTH,
  TIME_LIMIT_MAX_SEC,
  TIME_LIMIT_MIN_SEC,
} from "../constants.ts";
import { ChoiceIndex, Options, Prompt } from "../primitives.ts";

/**
 * Skema REST editor kuis. Web memakainya untuk validasi form sebelum mengirim,
 * API memakainya lagi untuk validasi ulang, karena server tidak percaya klien.
 */

export const QuizId = z.uuid();
export type QuizId = z.infer<typeof QuizId>;

export const QuestionId = z.uuid();
export type QuestionId = z.infer<typeof QuestionId>;

const QuestionFields = z.object({
  prompt: Prompt,
  options: Options,
  correctIndex: ChoiceIndex,
  timeLimitSec: z.number().int().min(TIME_LIMIT_MIN_SEC).max(TIME_LIMIT_MAX_SEC),
  explanation: z.string().trim().max(EXPLANATION_MAX_LENGTH).nullable(),
});

// ChoiceIndex hanya membatasi 0..MAX_OPTIONS-1; soal 2 opsi butuh batas yang lebih ketat.
const answerKeyInOptions = (question: { options: string[]; correctIndex: number }) =>
  question.correctIndex < question.options.length;
const answerKeyIssue = { message: "Jawaban benar harus salah satu opsi", path: ["correctIndex"] };

export const QuestionInput = QuestionFields.extend({ id: QuestionId.optional() }).refine(answerKeyInOptions, answerKeyIssue);
export type QuestionInput = z.infer<typeof QuestionInput>;

export const QuestionDetail = QuestionFields.extend({ id: QuestionId }).refine(answerKeyInOptions, answerKeyIssue);
export type QuestionDetail = z.infer<typeof QuestionDetail>;

const QuizTitle = z.string().trim().min(1, "Judul tidak boleh kosong").max(QUIZ_TITLE_MAX_LENGTH);
const QuizDescription = z.string().trim().max(QUIZ_DESCRIPTION_MAX_LENGTH).nullable();

/** Boleh 0 soal supaya kuis bisa disimpan sebagai draf. */
export const QuizInput = z.object({
  title: QuizTitle,
  description: QuizDescription,
  questions: z.array(QuestionInput).max(MAX_QUESTIONS_PER_QUIZ),
});
export type QuizInput = z.infer<typeof QuizInput>;

/** Soal diurutkan menurut `position` di D1. */
export const QuizDetail = z.object({
  id: QuizId,
  title: QuizTitle,
  description: QuizDescription,
  questions: z.array(QuestionDetail).max(MAX_QUESTIONS_PER_QUIZ),
  updatedAt: z.number().int().nonnegative(),
});
export type QuizDetail = z.infer<typeof QuizDetail>;

export const QuizSummary = z.object({
  id: QuizId,
  title: QuizTitle,
  description: QuizDescription,
  questionCount: z.number().int().min(0).max(MAX_QUESTIONS_PER_QUIZ),
  updatedAt: z.number().int().nonnegative(),
});
export type QuizSummary = z.infer<typeof QuizSummary>;
