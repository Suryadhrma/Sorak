import { describe, expect, it } from "vitest";
import { MAX_OPTIONS, MIN_OPTIONS, type QuizDetail } from "@sorak/shared";
import { draftFromQuiz, emptyQuizDraft, moveQuestion, newQuestionDraft, removeOption, validateDraft } from "../src/quiz-draft.ts";

const savedQuiz: QuizDetail = {
  id: "6f1c2a3e-8b4d-4c5e-9f6a-7b8c9d0e1f2a",
  title: "Kuis IPA",
  description: null,
  updatedAt: 1_000,
  questions: [
    {
      id: "0b7e4a1c-2d3f-4a5b-8c6d-7e8f9a0b1c2d",
      prompt: "Bulan memancarkan cahaya sendiri",
      options: ["Benar", "Salah"],
      correctIndex: 1,
      timeLimitSec: 10,
      explanation: null,
    },
    {
      id: "1c8f5b2d-3e4a-4b6c-9d7e-8f9a0b1c2d3e",
      prompt: "Planet terbesar?",
      options: ["Mars", "Jupiter", "Venus"],
      correctIndex: 1,
      timeLimitSec: 20,
      explanation: "Jupiter",
    },
  ],
};

describe("draf kosong", () => {
  it("soal baru punya MIN_OPTIONS opsi kosong dan key unik", () => {
    const first = newQuestionDraft();
    expect(first.options).toEqual(Array.from({ length: MIN_OPTIONS }, () => ""));
    expect(first.key).not.toBe(newQuestionDraft().key);
    expect(emptyQuizDraft().questions).toHaveLength(1);
  });
});

describe("draftFromQuiz lalu validateDraft", () => {
  it("bolak-balik mempertahankan id dan isi soal; null jadi teks kosong lalu kembali null", () => {
    const draft = draftFromQuiz(savedQuiz);
    expect(draft.description).toBe("");
    expect(draft.questions[0]?.explanation).toBe("");

    const result = validateDraft(draft);

    expect(result).toEqual({
      ok: true,
      input: { title: savedQuiz.title, description: null, questions: savedQuiz.questions },
    });
  });

  it("penjelasan yang isinya hanya spasi dikirim sebagai null", () => {
    const draft = draftFromQuiz(savedQuiz);
    const [first, second] = draft.questions;
    if (!first || !second) throw new Error("kuis contoh harus punya dua soal");
    const result = validateDraft({ ...draft, questions: [{ ...first, explanation: "   " }, second] });
    expect(result.ok && result.input.questions[0]?.explanation).toBeNull();
  });

  it("draf tidak valid menghasilkan fields dengan path yang sama dengan server", () => {
    const draft = emptyQuizDraft();
    const result = validateDraft(draft);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.fields).sort()).toEqual([
      "questions.0.options.0",
      "questions.0.options.1",
      "questions.0.prompt",
      "title",
    ]);
  });
});

describe("moveQuestion", () => {
  const questions = draftFromQuiz(savedQuiz).questions;
  const keys = (list: { key: string }[]) => list.map((q) => q.key);

  it("menukar soal dengan tetangganya", () => {
    expect(keys(moveQuestion(questions, 1, -1))).toEqual(keys([...questions].reverse()));
    expect(keys(moveQuestion(questions, 0, 1))).toEqual(keys([...questions].reverse()));
  });

  it("tidak berubah kalau sudah di ujung", () => {
    expect(moveQuestion(questions, 0, -1)).toEqual(questions);
    expect(moveQuestion(questions, 1, 1)).toEqual(questions);
  });
});

describe("removeOption", () => {
  const question = { ...newQuestionDraft(), options: ["A", "B", "C", "D"].slice(0, MAX_OPTIONS) };

  it("jawaban benar di belakang opsi yang dihapus ikut bergeser", () => {
    expect(removeOption({ ...question, correctIndex: 3 }, 1)).toMatchObject({ options: ["A", "C", "D"], correctIndex: 2 });
  });

  it("jawaban benar yang dihapus kembali ke opsi pertama", () => {
    expect(removeOption({ ...question, correctIndex: 1 }, 1)).toMatchObject({ correctIndex: 0 });
  });

  it("tidak menghapus kalau tinggal MIN_OPTIONS opsi", () => {
    const minimal = { ...question, options: ["A", "B"] };
    expect(removeOption(minimal, 0)).toEqual(minimal);
  });
});
