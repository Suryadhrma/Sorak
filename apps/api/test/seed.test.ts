import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { QuizDetail } from "@sorak/shared";
import { findQuiz } from "../src/quizzes.ts";
import { insertHost } from "./http.ts";

const DEMO_TITLE = "Kuis Demo Sorak";

async function runSeed() {
  const [seed] = env.TEST_SEED;
  if (!seed) throw new Error("seed/local.sql tidak terbaca");
  for (const query of seed.queries) await env.DB.prepare(query).run();
}

async function demoQuizzesOf(hostId: string) {
  const { results } = await env.DB.prepare("SELECT id FROM quizzes WHERE host_id = ? AND title = ?")
    .bind(hostId, DEMO_TITLE)
    .all<{ id: string }>();
  return results;
}

describe("seed lokal", () => {
  it("idempoten: dijalankan dua kali tetap satu kuis demo berisi 10 soal yang lolos QuizDetail", async () => {
    const hostId = crypto.randomUUID();
    await insertHost({ id: hostId, email: "seed@example.com" });

    await runSeed();
    await runSeed();

    const quizzes = await demoQuizzesOf(hostId);
    expect(quizzes).toHaveLength(1);
    const quiz = QuizDetail.parse(await findQuiz(env.DB, hostId, quizzes[0]?.id ?? ""));
    expect(quiz.questions).toHaveLength(10);
    expect(new Set(quiz.questions.map((q) => q.id)).size).toBe(10);
    expect(quiz.questions.some((q) => q.explanation !== null)).toBe(true);
    expect(new Set(quiz.questions.map((q) => q.options.length))).toEqual(new Set([2, 3, 4]));
  });

  it("host yang login setelah seed pertama ikut mendapat kuis demo di seed berikutnya, tanpa menggandakan milik host lama", async () => {
    const earlyHost = crypto.randomUUID();
    await insertHost({ id: earlyHost, email: "awal@example.com" });
    await runSeed();

    const lateHost = crypto.randomUUID();
    await insertHost({ id: lateHost, email: "telat@example.com" });
    await runSeed();

    expect(await demoQuizzesOf(earlyHost)).toHaveLength(1);
    const lateQuizzes = await demoQuizzesOf(lateHost);
    expect(lateQuizzes).toHaveLength(1);
    expect((await findQuiz(env.DB, lateHost, lateQuizzes[0]?.id ?? ""))?.questions).toHaveLength(10);
  });
});
