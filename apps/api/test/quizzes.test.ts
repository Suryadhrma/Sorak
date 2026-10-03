import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  QUIZ_BODY_MAX_BYTES,
  QUIZ_LIST_LIMIT,
  QuizDetail,
  QuizSummary,
  type QuestionInput,
  type QuizInput,
} from "@sorak/shared";
import { LIST_QUIZZES_SQL, QUESTIONS_OF_QUIZ_SQL } from "../src/quizzes.ts";
import { request, signedInHost } from "./http.ts";

const question = (prompt: string, extra: Partial<QuestionInput> = {}): QuestionInput => ({
  prompt,
  options: ["Benar", "Salah"],
  correctIndex: 0,
  timeLimitSec: 20,
  explanation: null,
  ...extra,
});

const quizInput = (extra: Partial<QuizInput> = {}): QuizInput => ({
  title: "Kuis IPA",
  description: null,
  questions: [question("Air mendidih pada 100 °C di permukaan laut"), question("Bulan memancarkan cahaya sendiri", { correctIndex: 1 })],
  ...extra,
});

type Host = Awaited<ReturnType<typeof signedInHost>>;

async function createQuiz(host: Host, input: QuizInput = quizInput()) {
  const res = await host.send("/api/quizzes", { method: "POST", json: input });
  expect(res.status).toBe(201);
  return QuizDetail.parse(await res.json());
}

function firstTwo(quiz: QuizDetail) {
  const [first, second] = quiz.questions;
  if (!first || !second) throw new Error("kuis test harus punya minimal dua soal");
  return { first, second };
}

async function questionRowCount(quizId: string) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?").bind(quizId).first<{ n: number }>();
  return row?.n;
}

describe("akses", () => {
  it("tanpa login: 401", async () => {
    expect((await request("/api/quizzes")).status).toBe(401);
  });

  it("id yang bukan UUID: 404", async () => {
    const host = await signedInHost();
    expect((await host.send("/api/quizzes/bukan-uuid")).status).toBe(404);
  });
});

describe("CRUD kuis", () => {
  it("membuat, membaca, mendaftar, mengubah, lalu menghapus kuis", async () => {
    const host = await signedInHost();

    const created = await createQuiz(host);
    expect(created.title).toBe("Kuis IPA");
    expect(created.questions.map((q) => q.prompt)).toEqual([
      "Air mendidih pada 100 °C di permukaan laut",
      "Bulan memancarkan cahaya sendiri",
    ]);

    const fetched = await host.send(`/api/quizzes/${created.id}`);
    expect(QuizDetail.parse(await fetched.json())).toEqual(created);

    const list = QuizSummary.array().parse(await (await host.send("/api/quizzes")).json());
    expect(list).toEqual([
      { id: created.id, title: "Kuis IPA", description: null, questionCount: 2, updatedAt: created.updatedAt },
    ]);

    const updatedRes = await host.send(`/api/quizzes/${created.id}`, {
      method: "PUT",
      json: quizInput({ title: "Kuis IPA (revisi)", description: "Kelas 7", questions: [question("Soal pengganti")] }),
    });
    expect(updatedRes.status).toBe(200);
    const updated = QuizDetail.parse(await updatedRes.json());
    expect(updated).toMatchObject({ title: "Kuis IPA (revisi)", description: "Kelas 7" });
    expect(updated.questions.map((q) => q.prompt)).toEqual(["Soal pengganti"]);

    const deleted = await host.send(`/api/quizzes/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await host.send(`/api/quizzes/${created.id}`)).status).toBe(404);
  });

  it("daftar kuis urut dari yang terakhir diubah dan dibatasi QUIZ_LIST_LIMIT", async () => {
    const host = await signedInHost();
    const insert = env.DB.prepare(
      "INSERT INTO quizzes (id, host_id, title, description, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
    );
    await env.DB.batch(
      Array.from({ length: QUIZ_LIST_LIMIT + 1 }, (_, i) => insert.bind(crypto.randomUUID(), host.id, `Kuis ${i}`, i, i)),
    );

    const list = QuizSummary.array().parse(await (await host.send("/api/quizzes")).json());

    expect(list).toHaveLength(QUIZ_LIST_LIMIT);
    expect(list[0]?.title).toBe(`Kuis ${QUIZ_LIST_LIMIT}`);
    expect(list.at(-1)?.title).toBe("Kuis 1");
  });

  it("DELETE ikut menghapus soal-soalnya", async () => {
    const host = await signedInHost();
    const created = await createQuiz(host);
    expect(await questionRowCount(created.id)).toBe(2);

    await host.send(`/api/quizzes/${created.id}`, { method: "DELETE" });

    expect(await questionRowCount(created.id)).toBe(0);
  });
});

describe("kepemilikan", () => {
  it("kuis host lain diperlakukan seperti tidak ada: 404 untuk GET, PUT, DELETE, dan isinya tidak berubah", async () => {
    const owner = await signedInHost();
    const intruder = await signedInHost();
    const quiz = await createQuiz(owner);
    const path = `/api/quizzes/${quiz.id}`;

    expect((await intruder.send(path)).status).toBe(404);
    expect((await intruder.send(path, { method: "PUT", json: quizInput({ title: "Dibajak" }) })).status).toBe(404);
    expect((await intruder.send(path, { method: "DELETE" })).status).toBe(404);

    expect(QuizDetail.parse(await (await owner.send(path)).json())).toEqual(quiz);
    expect(await (await intruder.send("/api/quizzes")).json()).toEqual([]);
  });
});

describe("validasi body", () => {
  it("body tidak valid: 400 VALIDATION_FAILED dengan fields per kotak", async () => {
    const host = await signedInHost();
    const res = await host.send("/api/quizzes", {
      method: "POST",
      json: { title: "", description: null, questions: [question("Soal", { options: ["A", "B"], correctIndex: 2 })] },
    });

    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; fields: Record<string, string> } }>();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.error.fields).sort()).toEqual(["questions.0.correctIndex", "title"]);
  });

  it("JSON rusak: 400 VALIDATION_FAILED", async () => {
    const host = await signedInHost();
    const res = await host.send("/api/quizzes", { method: "POST", body: "{bukan json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("body di atas QUIZ_BODY_MAX_BYTES: 413 PAYLOAD_TOO_LARGE", async () => {
    const host = await signedInHost();
    const res = await host.send("/api/quizzes", { method: "POST", body: " ".repeat(QUIZ_BODY_MAX_BYTES + 1) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });
});

describe("PUT mengganti seluruh isi kuis", () => {
  it("soal yang id-nya milik kuis ini mempertahankan id dan created_at", async () => {
    const host = await signedInHost();
    const quiz = await createQuiz(host);
    const { first, second } = firstTwo(quiz);
    const before = await env.DB.prepare("SELECT id, created_at FROM questions WHERE quiz_id = ? ORDER BY position")
      .bind(quiz.id)
      .all<{ id: string; created_at: number }>();

    const res = await host.send(`/api/quizzes/${quiz.id}`, {
      method: "PUT",
      json: quizInput({ questions: [{ ...first, prompt: "Prompt diubah" }, second, question("Soal baru")] }),
    });
    const updated = QuizDetail.parse(await res.json());

    expect(updated.questions.map((q) => q.id).slice(0, 2)).toEqual([first.id, second.id]);
    expect(updated.questions[0]?.prompt).toBe("Prompt diubah");
    const after = await env.DB.prepare("SELECT id, created_at FROM questions WHERE quiz_id = ? ORDER BY position LIMIT 2")
      .bind(quiz.id)
      .all<{ id: string; created_at: number }>();
    expect(after.results).toEqual(before.results);
  });

  it("id soal milik kuis lain diganti id baru, dan soal di kuis lain itu tidak tersentuh", async () => {
    const host = await signedInHost();
    const victim = await createQuiz(host, quizInput({ title: "Kuis korban" }));
    const target = await createQuiz(host, quizInput({ questions: [] }));
    const stolenId = victim.questions[0]?.id;

    const res = await host.send(`/api/quizzes/${target.id}`, {
      method: "PUT",
      json: quizInput({ questions: [question("Soal curian", { id: stolenId })] }),
    });
    const updated = QuizDetail.parse(await res.json());

    expect(updated.questions[0]?.id).not.toBe(stolenId);
    expect(QuizDetail.parse(await (await host.send(`/api/quizzes/${victim.id}`)).json())).toEqual(victim);
  });

  it("id yang sama dikirim dua kali: salinan kedua mendapat id baru", async () => {
    const host = await signedInHost();
    const quiz = await createQuiz(host);
    const { first } = firstTwo(quiz);

    const res = await host.send(`/api/quizzes/${quiz.id}`, { method: "PUT", json: quizInput({ questions: [first, first] }) });

    expect(res.status).toBe(200);
    const ids = QuizDetail.parse(await res.json()).questions.map((q) => q.id);
    expect(ids[0]).toBe(first.id);
    expect(ids[1]).not.toBe(first.id);
  });

  it("menukar urutan soal tidak bentrok dengan UNIQUE (quiz_id, position)", async () => {
    const host = await signedInHost();
    const quiz = await createQuiz(host);
    const { first, second } = firstTwo(quiz);

    const res = await host.send(`/api/quizzes/${quiz.id}`, { method: "PUT", json: quizInput({ questions: [second, first] }) });

    expect(res.status).toBe(200);
    expect(QuizDetail.parse(await res.json()).questions.map((q) => q.id)).toEqual([second.id, first.id]);
  });
});

describe("EXPLAIN QUERY PLAN", () => {
  // Indeks otomatis dari UNIQUE (quiz_id, position); nomornya ditentukan SQLite, jadi yang dicek kolomnya.
  const QUESTIONS_BY_QUIZ_INDEX = /SEARCH questions USING (COVERING )?INDEX sqlite_autoindex_questions_\d+ \(quiz_id=\?\)/;

  async function plan(sql: string, ...params: unknown[]) {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    return results.map((row) => row.detail);
  }

  it("daftar kuis memakai quizzes_host_updated_idx, dan hitung soal memakai indeks unik (quiz_id, position)", async () => {
    const details = await plan(LIST_QUIZZES_SQL, "host", QUIZ_LIST_LIMIT);
    expect(details).toContainEqual(expect.stringMatching(/^SEARCH q USING INDEX quizzes_host_updated_idx/));
    expect(details).toContainEqual(expect.stringMatching(QUESTIONS_BY_QUIZ_INDEX));
    expect(details.join("\n")).not.toMatch(/SCAN|TEMP B-TREE/);
  });

  it("soal per kuis memakai indeks unik (quiz_id, position) tanpa sort tambahan", async () => {
    const details = await plan(QUESTIONS_OF_QUIZ_SQL, "quiz", "host");
    expect(details).toContainEqual(expect.stringMatching(QUESTIONS_BY_QUIZ_INDEX));
    expect(details).toContainEqual(expect.stringMatching(/SEARCH quizzes USING INDEX sqlite_autoindex_quizzes_1 \(id=\?\)/));
    expect(details.join("\n")).not.toMatch(/SCAN|TEMP B-TREE/);
  });
});
