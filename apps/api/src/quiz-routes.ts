import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { QUIZ_BODY_MAX_BYTES, QuizId, QuizInput, fieldErrors, type Host } from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { createQuiz, deleteQuiz, findQuiz, listQuizzes, replaceQuiz } from "./quizzes.ts";
import { requireHost } from "./session.ts";

type QuizEnv = { Bindings: Env; Variables: { host: Host } };

export const quizRoutes = new Hono<QuizEnv>();

quizRoutes.use("*", requireHost);

const quizBodyLimit = bodyLimit({
  maxSize: QUIZ_BODY_MAX_BYTES,
  onError: (c) => apiError(c, 413, "PAYLOAD_TOO_LARGE", "Kuis terlalu besar untuk disimpan"),
});

// Kuis milik host lain dijawab sama dengan kuis yang tidak ada, supaya id yang valid tidak bisa ditebak.
const quizNotFound = (c: Context) => apiError(c, 404, "NOT_FOUND", "Kuis tidak ditemukan");

async function readQuizInput(c: Context<QuizEnv>): Promise<QuizInput | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) return apiError(c, 400, "VALIDATION_FAILED", "Body bukan JSON yang valid");
    throw error;
  }
  const input = QuizInput.safeParse(body);
  if (!input.success) {
    return apiError(c, 400, "VALIDATION_FAILED", "Isi kuis belum valid", fieldErrors(input.error.issues));
  }
  return input.data;
}

quizRoutes.get("/", async (c) => {
  return c.json(await listQuizzes(c.env.DB, c.var.host.id));
});

quizRoutes.post("/", quizBodyLimit, async (c) => {
  const input = await readQuizInput(c);
  if (input instanceof Response) return input;

  const quizId = await createQuiz(c.env.DB, c.var.host.id, input, Date.now());
  const quiz = await findQuiz(c.env.DB, c.var.host.id, quizId);
  if (!quiz) throw new Error(`quiz ${quizId} hilang tepat setelah dibuat`);
  return c.json(quiz, 201);
});

quizRoutes.get("/:id", async (c) => {
  const quizId = QuizId.safeParse(c.req.param("id"));
  if (!quizId.success) return quizNotFound(c);

  const quiz = await findQuiz(c.env.DB, c.var.host.id, quizId.data);
  return quiz ? c.json(quiz) : quizNotFound(c);
});

quizRoutes.put("/:id", quizBodyLimit, async (c) => {
  const quizId = QuizId.safeParse(c.req.param("id"));
  if (!quizId.success) return quizNotFound(c);
  const input = await readQuizInput(c);
  if (input instanceof Response) return input;

  const replaced = await replaceQuiz(c.env.DB, c.var.host.id, quizId.data, input, Date.now());
  if (!replaced) return quizNotFound(c);
  const quiz = await findQuiz(c.env.DB, c.var.host.id, quizId.data);
  return quiz ? c.json(quiz) : quizNotFound(c);
});

quizRoutes.delete("/:id", async (c) => {
  const quizId = QuizId.safeParse(c.req.param("id"));
  if (!quizId.success) return quizNotFound(c);

  const deleted = await deleteQuiz(c.env.DB, c.var.host.id, quizId.data);
  return deleted ? c.body(null, 204) : quizNotFound(c);
});
