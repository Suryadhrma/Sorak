import { describe, expect, it } from "vitest";
import {
  EXPLANATION_MAX_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS_PER_QUIZ,
  OPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  QUIZ_BODY_MAX_BYTES,
  QUIZ_DESCRIPTION_MAX_LENGTH,
  QUIZ_TITLE_MAX_LENGTH,
  QuestionInput,
  QuizInput,
  TIME_LIMIT_MAX_SEC,
  type QuestionInput as QuestionInputType,
} from "../src/index.ts";

const question = (extra: Partial<QuestionInputType> = {}): QuestionInputType => ({
  prompt: "Ibu kota Indonesia?",
  options: ["Jakarta", "Bandung", "Surabaya"],
  correctIndex: 0,
  timeLimitSec: 20,
  explanation: null,
  ...extra,
});

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((issue) => issue.path.join("."));

describe("QuestionInput", () => {
  it("menerima soal yang valid", () => {
    expect(QuestionInput.safeParse(question()).success).toBe(true);
  });

  it("menolak correctIndex di luar jumlah opsi, dengan error di path correctIndex", () => {
    const result = QuestionInput.safeParse(question({ options: ["Ya", "Tidak"], correctIndex: 2 }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(["correctIndex"]);
  });

  it.each([
    ["1 opsi", { options: ["Jakarta"] }],
    ["5 opsi", { options: ["A", "B", "C", "D", "E"] }],
    ["prompt kosong", { prompt: "" }],
  ])("menolak %s", (_label, extra) => {
    expect(QuestionInput.safeParse(question(extra)).success).toBe(false);
  });

  it("menolak id yang bukan UUID", () => {
    expect(QuestionInput.safeParse(question({ id: "soal-1" })).success).toBe(false);
  });
});

describe("QuizInput", () => {
  it("menerima kuis draf tanpa soal dan merapikan judul", () => {
    const result = QuizInput.safeParse({ title: "  Kuis IPA  ", description: null, questions: [] });
    expect(result.success && result.data.title).toBe("Kuis IPA");
  });

  it("menolak judul yang isinya hanya spasi", () => {
    expect(QuizInput.safeParse({ title: "   ", description: null, questions: [] }).success).toBe(false);
  });

  it(`menolak ${MAX_QUESTIONS_PER_QUIZ + 1} soal`, () => {
    const questions = Array.from({ length: MAX_QUESTIONS_PER_QUIZ + 1 }, () => question());
    expect(QuizInput.safeParse({ title: "Kuis", description: null, questions }).success).toBe(false);
  });

  it("menunjuk soal yang salah lewat path", () => {
    const questions = [question(), question(), question(), question({ correctIndex: 3 })];
    const result = QuizInput.safeParse({ title: "Kuis", description: null, questions });
    expect(issuePaths(result)).toEqual(["questions.3.correctIndex"]);
  });
});

describe("anggaran ukuran body kuis", () => {
  it("kuis terpanjang yang valid, seluruhnya huruf Arab, muat di QUIZ_BODY_MAX_BYTES", () => {
    // Huruf Arab memakai 2 byte di UTF-8, jadi ini mendekati kasus terburuk untuk kuis madrasah.
    const arabic = (length: number) => "ع".repeat(length);
    const fullQuestion = question({
      id: "6f1c2a3e-8b4d-4c5e-9f6a-7b8c9d0e1f2a",
      prompt: arabic(PROMPT_MAX_LENGTH),
      options: Array.from({ length: MAX_OPTIONS }, () => arabic(OPTION_MAX_LENGTH)),
      correctIndex: MAX_OPTIONS - 1,
      timeLimitSec: TIME_LIMIT_MAX_SEC,
      explanation: arabic(EXPLANATION_MAX_LENGTH),
    });
    const quiz = {
      title: arabic(QUIZ_TITLE_MAX_LENGTH),
      description: arabic(QUIZ_DESCRIPTION_MAX_LENGTH),
      questions: Array.from({ length: MAX_QUESTIONS_PER_QUIZ }, () => fullQuestion),
    };

    expect(QuizInput.safeParse(quiz).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(quiz)).byteLength).toBeLessThan(QUIZ_BODY_MAX_BYTES);
  });
});
