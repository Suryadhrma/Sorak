import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_LIMIT_SEC, MAX_QUESTIONS_PER_QUIZ, type AiDraft } from "@sorak/shared";
import {
  aiReducer,
  appendSelected,
  deriveOrigin,
  initialAiState,
  roomLeft,
  toReviewDrafts,
  type AiAction,
  type AiState,
  type ReviewDraft,
} from "../src/ai-draft.ts";
import { draftFromQuiz, emptyQuizDraft, newQuestionDraft, validateDraft, type QuestionDraft } from "../src/quiz-draft.ts";

const aiDraft = (i: number, grounded = true): AiDraft => ({
  prompt: `Soal nomor ${i + 1} tentang sel?`,
  options: ["Mitokondria", "Ribosom", "Membran sel", "Inti sel"],
  correctIndex: 1,
  explanation: "Materi menyebut ribosom sebagai tempat sintesis protein.",
  evidence: "Ribosom adalah tempat sintesis protein.",
  grounded,
});

function keys() {
  let n = 0;
  return () => `k${++n}`;
}

const reviewOf = (drafts: AiDraft[]) => toReviewDrafts(drafts, keys());

function run(...actions: AiAction[]): AiState {
  return actions.reduce(aiReducer, initialAiState);
}

const failed = (code: Extract<AiAction, { type: "failed" }>["code"], retryAfterSec: number | null = null): AiAction => ({
  type: "failed",
  code,
  message: `pesan ${code}`,
  retryAfterSec,
  now: 1_000,
});

describe("deriveOrigin", () => {
  const source = aiDraft(0);

  it("tidak diubah -> ai; spasi di tepi tidak dihitung", () => {
    expect(deriveOrigin(source, source)).toBe("ai");
    expect(deriveOrigin(source, { ...source, prompt: `  ${source.prompt} ` })).toBe("ai");
  });

  it("teks soal, salah satu pilihan, atau jawaban benar diubah -> ai_edited", () => {
    expect(deriveOrigin(source, { ...source, prompt: "Soal lain?" })).toBe("ai_edited");
    expect(deriveOrigin(source, { ...source, options: ["Mitokondria", "Ribosom", "Membran", "Inti sel"] })).toBe("ai_edited");
    expect(deriveOrigin(source, { ...source, correctIndex: 2 })).toBe("ai_edited");
    expect(deriveOrigin(source, { ...source, options: [...source.options, "Lisosom"] })).toBe("ai_edited");
  });

  it("mengetik lalu mengembalikan teks semula tetap ai (dibandingkan isi, bukan flag)", () => {
    const edited = { ...source, prompt: "sementara" };
    expect(deriveOrigin(source, { ...edited, prompt: source.prompt })).toBe("ai");
  });
});

describe("toReviewDrafts", () => {
  it("draf grounded tercentang, yang tidak grounded tidak", () => {
    expect(reviewOf([aiDraft(0), aiDraft(1, false)]).map((draft) => draft.selected)).toEqual([true, false]);
  });
});

describe("aiReducer", () => {
  const drafts = reviewOf([aiDraft(0), aiDraft(1, false)]);

  it("idle -> loading -> review -> added", () => {
    const loading = run({ type: "start" });
    expect(loading.flow.kind).toBe("loading");
    const review = aiReducer(loading, { type: "succeeded", drafts });
    expect(review.flow).toEqual({ kind: "review", drafts });
    expect(aiReducer(review, { type: "added", count: 1, firstNumber: 3 }).flow).toEqual({ kind: "added", count: 1, firstNumber: 3 });
  });

  it("Batal: loading -> idle, dan respons yang tiba sesudahnya diabaikan", () => {
    const cancelled = run({ type: "start" }, { type: "cancel" });
    expect(cancelled.flow.kind).toBe("idle");
    expect(aiReducer(cancelled, { type: "succeeded", drafts })).toBe(cancelled);
    expect(aiReducer(cancelled, failed("AI_UNAVAILABLE"))).toBe(cancelled);
  });

  it("loading -> error; dari error bisa mencoba lagi", () => {
    const error = run({ type: "start" }, failed("AI_UNAVAILABLE"));
    expect(error.flow).toEqual({ kind: "error", code: "AI_UNAVAILABLE", message: "pesan AI_UNAVAILABLE", retry: null });
    expect(aiReducer(error, { type: "start" }).flow.kind).toBe("loading");
  });

  it("AI_RATE_LIMITED membawa hitung mundur dari retryAfterSec", () => {
    const state = run({ type: "start" }, failed("AI_RATE_LIMITED", 12));
    expect(state.flow).toMatchObject({ kind: "error", retry: { startedAt: 1_000, durationMs: 12_000 } });
  });

  it("AI_QUOTA_EXCEEDED mengunci tombol sampai halaman dimuat ulang", () => {
    const state = run({ type: "start" }, failed("AI_QUOTA_EXCEEDED"), { type: "dismiss" });
    expect(state.quotaMessage).toBe("pesan AI_QUOTA_EXCEEDED");
    expect(aiReducer(state, { type: "start" })).toBe(state);
  });

  it("edit mengubah satu draf saja, dan hanya di keadaan review", () => {
    const review = run({ type: "start" }, { type: "succeeded", drafts });
    const edited = aiReducer(review, { type: "edit", key: "k2", patch: { selected: true, prompt: "Diubah?" } });
    expect(edited.flow.kind === "review" && edited.flow.drafts.map((d) => [d.selected, d.prompt])).toEqual([
      [true, "Soal nomor 1 tentang sel?"],
      [true, "Diubah?"],
    ]);
    expect(aiReducer(initialAiState, { type: "edit", key: "k1", patch: { selected: false } })).toBe(initialAiState);
  });

  it("Buang semua: review -> idle; menambahkan 0 soal diabaikan", () => {
    const review = run({ type: "start" }, { type: "succeeded", drafts });
    expect(aiReducer(review, { type: "discard" }).flow.kind).toBe("idle");
    expect(aiReducer(review, { type: "added", count: 0, firstNumber: 1 })).toBe(review);
  });

  it("start diabaikan saat masih loading (klik ganda tidak mengirim dua permintaan)", () => {
    const loading = run({ type: "start" });
    expect(aiReducer(loading, { type: "start" })).toBe(loading);
  });
});

describe("appendSelected dan roomLeft", () => {
  const filled = (count: number): QuestionDraft[] =>
    Array.from({ length: count }, (_, i) => ({ ...newQuestionDraft(), prompt: `Soal manual ${i}`, options: ["Ya", "Tidak"] }));

  it("hanya yang dicentang ditambahkan, di akhir daftar, dengan origin dan waktu bawaan", () => {
    const [first, second, third] = reviewOf([aiDraft(0), aiDraft(1, false), aiDraft(2)]);
    if (!first || !second || !third) throw new Error("harus ada tiga draf");
    const edited: ReviewDraft = { ...third, correctIndex: 0 };
    const result = appendSelected(filled(2), [first, second, edited], keys());
    expect(result.map((q) => [q.prompt, q.origin])).toEqual([
      ["Soal manual 0", "manual"],
      ["Soal manual 1", "manual"],
      ["Soal nomor 1 tentang sel?", "ai"],
      ["Soal nomor 3 tentang sel?", "ai_edited"],
    ]);
    expect(result[2]?.timeLimitSec).toBe(DEFAULT_TIME_LIMIT_SEC);
  });

  it("satu soal kosong bawaan kuis baru diganti, bukan ditambah di bawahnya", () => {
    const result = appendSelected(emptyQuizDraft().questions, reviewOf([aiDraft(0)]), keys());
    expect(result.map((q) => q.origin)).toEqual(["ai"]);
    expect(roomLeft(emptyQuizDraft().questions)).toBe(MAX_QUESTIONS_PER_QUIZ);
  });

  it("sisa tempat mengikuti MAX_QUESTIONS_PER_QUIZ", () => {
    expect(roomLeft(filled(MAX_QUESTIONS_PER_QUIZ - 3))).toBe(3);
    expect(roomLeft(filled(MAX_QUESTIONS_PER_QUIZ))).toBe(0);
  });

  it("soal AI yang diedit di editor setelah ditambahkan tersimpan sebagai ai_edited", () => {
    const [added] = appendSelected([], reviewOf([aiDraft(0)]), keys());
    if (!added) throw new Error("harus ada satu soal");
    const quiz = { title: "Sel", description: "", questions: [{ ...added, correctIndex: 3 }] };
    const result = validateDraft(quiz);
    expect(result.ok && result.input.questions[0]?.origin).toBe("ai_edited");
  });

  it("soal ber-origin ai dari server: diubah -> ai_edited, tidak diubah -> tetap ai", () => {
    const id = "0b7e4a1c-2d3f-4a5b-8c6d-7e8f9a0b1c2d";
    const saved = {
      id: "6f1c2a3e-8b4d-4c5e-9f6a-7b8c9d0e1f2a",
      title: "Sel",
      description: null,
      updatedAt: 1,
      questions: [{ ...aiDraft(0), id, timeLimitSec: 20, origin: "ai" as const }],
    };
    const draft = draftFromQuiz(saved);
    const untouched = validateDraft(draft);
    expect(untouched.ok && untouched.input.questions[0]?.origin).toBe("ai");
    const changed = validateDraft({ ...draft, questions: draft.questions.map((q) => ({ ...q, prompt: "Soal yang diubah?" })) });
    expect(changed.ok && changed.input.questions[0]?.origin).toBe("ai_edited");
  });
});
