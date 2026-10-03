import { z } from "zod";
import {
  Options,
  QuestionDetail,
  QUIZ_LIST_LIMIT,
  QuizSummary,
  type QuizDetail,
  type QuizInput,
} from "@sorak/shared";
import { log } from "./log.ts";

// Diekspor supaya test EXPLAIN QUERY PLAN memeriksa query yang sama persis dengan yang dijalankan.
export const LIST_QUIZZES_SQL = `
  SELECT q.id, q.title, q.description, q.updated_at,
         (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
  FROM quizzes q
  WHERE q.host_id = ?
  ORDER BY q.updated_at DESC
  LIMIT ?`;

export const QUESTIONS_OF_QUIZ_SQL = `
  SELECT id, prompt, options, correct_index, time_limit_sec, explanation
  FROM questions
  WHERE quiz_id = (SELECT id FROM quizzes WHERE id = ? AND host_id = ?)
  ORDER BY position`;

const QUIZ_OF_HOST_SQL = "SELECT id, title, description, updated_at FROM quizzes WHERE id = ? AND host_id = ?";

const INSERT_QUESTION_SQL = `
  INSERT INTO questions
    (id, quiz_id, position, prompt, options, correct_index, time_limit_sec, explanation, origin, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const QuizSummaryRow = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    question_count: z.number(),
    updated_at: z.number(),
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    questionCount: row.question_count,
    updatedAt: row.updated_at,
  }))
  .pipe(QuizSummary);

export function toQuizSummary(row: unknown): QuizSummary {
  return QuizSummaryRow.parse(row);
}

const QuestionDetailRow = z
  .object({
    id: z.string(),
    prompt: z.string(),
    // Kolom JSON di D1; CHECK json_valid menjamin bisa di-parse, Options memastikan isinya.
    options: z
      .string()
      .transform((text): unknown => JSON.parse(text))
      .pipe(Options),
    correct_index: z.number(),
    time_limit_sec: z.number(),
    explanation: z.string().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    prompt: row.prompt,
    options: row.options,
    correctIndex: row.correct_index,
    timeLimitSec: row.time_limit_sec,
    explanation: row.explanation,
  }))
  .pipe(QuestionDetail);

export function toQuestionDetail(row: unknown): QuestionDetail {
  return QuestionDetailRow.parse(row);
}

const QuizRow = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  updated_at: z.number(),
});

const ExistingQuestionRow = z.object({
  id: z.string(),
  created_at: z.number(),
  origin: z.enum(["manual", "ai", "ai_edited"]),
});

export async function listQuizzes(db: D1Database, hostId: string): Promise<QuizSummary[]> {
  const { results } = await db.prepare(LIST_QUIZZES_SQL).bind(hostId, QUIZ_LIST_LIMIT).all();
  return results.map(toQuizSummary);
}

export async function findQuiz(db: D1Database, hostId: string, quizId: string): Promise<QuizDetail | null> {
  const [quizResult, questionResult] = await db.batch([
    db.prepare(QUIZ_OF_HOST_SQL).bind(quizId, hostId),
    db.prepare(QUESTIONS_OF_QUIZ_SQL).bind(quizId, hostId),
  ]);
  const quizRow = quizResult?.results[0];
  if (!quizRow) return null;
  const quiz = QuizRow.parse(quizRow);
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    questions: (questionResult?.results ?? []).map(toQuestionDetail),
    updatedAt: quiz.updated_at,
  };
}

type StoredQuestion = { id: string; createdAt: number; origin: z.infer<typeof ExistingQuestionRow>["origin"] };

function insertQuestions(db: D1Database, quizId: string, input: QuizInput, existing: Map<string, StoredQuestion>, now: number) {
  const used = new Set<string>();
  return input.questions.map((question, position) => {
    // Id dari klien hanya dipakai kalau memang milik kuis ini dan belum dipakai soal lain di body yang sama.
    const kept = question.id && !used.has(question.id) ? existing.get(question.id) : undefined;
    const stored = kept ?? { id: crypto.randomUUID(), createdAt: now, origin: "manual" as const };
    used.add(stored.id);
    return db
      .prepare(INSERT_QUESTION_SQL)
      .bind(
        stored.id,
        quizId,
        position,
        question.prompt,
        JSON.stringify(question.options),
        question.correctIndex,
        question.timeLimitSec,
        question.explanation,
        stored.origin,
        stored.createdAt,
        now,
      );
  });
}

function rowsWritten(results: D1Result[]): number {
  return results.reduce((total, result) => total + result.meta.rows_written, 0);
}

export async function createQuiz(db: D1Database, hostId: string, input: QuizInput, now: number): Promise<string> {
  const quizId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare("INSERT INTO quizzes (id, host_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(quizId, hostId, input.title, input.description, now, now),
    ...insertQuestions(db, quizId, input, new Map(), now),
  ]);
  log.info("quiz_created", { quizId, questions: input.questions.length, rowsWritten: rowsWritten(results) });
  return quizId;
}

/** False kalau kuis tidak ada atau milik host lain. */
export async function replaceQuiz(db: D1Database, hostId: string, quizId: string, input: QuizInput, now: number): Promise<boolean> {
  const [ownership, existingResult] = await db.batch([
    db.prepare("SELECT 1 FROM quizzes WHERE id = ? AND host_id = ?").bind(quizId, hostId),
    db
      .prepare("SELECT id, created_at, origin FROM questions WHERE quiz_id = (SELECT id FROM quizzes WHERE id = ? AND host_id = ?)")
      .bind(quizId, hostId),
  ]);
  if (!ownership?.results.length) return false;

  const existing = new Map<string, StoredQuestion>();
  for (const row of existingResult?.results ?? []) {
    const question = ExistingQuestionRow.parse(row);
    existing.set(question.id, { id: question.id, createdAt: question.created_at, origin: question.origin });
  }

  // Hapus lalu tulis ulang dalam satu batch: UNIQUE (quiz_id, position) membuat tukar urutan
  // bentrok kalau soal di-update satu per satu, dan batch menjamin semua masuk atau semua batal.
  const results = await db.batch([
    db
      .prepare("UPDATE quizzes SET title = ?, description = ?, updated_at = ? WHERE id = ? AND host_id = ?")
      .bind(input.title, input.description, now, quizId, hostId),
    db.prepare("DELETE FROM questions WHERE quiz_id = (SELECT id FROM quizzes WHERE id = ? AND host_id = ?)").bind(quizId, hostId),
    ...insertQuestions(db, quizId, input, existing, now),
  ]);
  log.info("quiz_replaced", { quizId, questions: input.questions.length, rowsWritten: rowsWritten(results) });
  return true;
}

/** False kalau kuis tidak ada atau milik host lain. Soal ikut terhapus lewat ON DELETE CASCADE. */
export async function deleteQuiz(db: D1Database, hostId: string, quizId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM quizzes WHERE id = ? AND host_id = ?").bind(quizId, hostId).run();
  return result.meta.changes > 0;
}
