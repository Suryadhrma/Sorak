import { DEFAULT_TIME_LIMIT_SEC, MAX_QUESTIONS_PER_QUIZ, type AiDraft, type ApiErrorCode } from "@sorak/shared";
import type { QuestionDraft } from "./quiz-draft.ts";

/** Bagian soal yang menentukan origin: kalau salah satunya diubah guru, soal itu bukan lagi buatan AI murni. */
export type GradedContent = { prompt: string; options: readonly string[]; correctIndex: number };

/** Draf AI di layar review: isi yang bisa diedit, beserta salinan asli untuk deriveOrigin. */
export type ReviewDraft = GradedContent & {
  key: string;
  source: AiDraft;
  options: string[];
  explanation: string;
  selected: boolean;
};

/**
 * `ai` kalau teks soal, pilihan, dan jawaban benar sama dengan draf asli; `ai_edited` kalau ada yang diubah.
 * Dibandingkan langsung dengan aslinya, bukan flag "pernah diedit": mengetik lalu mengembalikan teks tetap `ai`.
 * Spasi di tepi tidak dihitung karena server men-trim teks saat menyimpan.
 */
export function deriveOrigin(source: GradedContent, edited: GradedContent): "ai" | "ai_edited" {
  const same =
    source.prompt.trim() === edited.prompt.trim() &&
    source.correctIndex === edited.correctIndex &&
    source.options.length === edited.options.length &&
    source.options.every((option, index) => option.trim() === edited.options[index]?.trim());
  return same ? "ai" : "ai_edited";
}

/** Yang grounded tercentang; yang buktinya tidak ditemukan dibiarkan kosong supaya guru memeriksanya dulu. */
export function toReviewDrafts(drafts: readonly AiDraft[], makeKey: () => string): ReviewDraft[] {
  return drafts.map((source) => ({
    key: makeKey(),
    source,
    prompt: source.prompt,
    options: [...source.options],
    correctIndex: source.correctIndex,
    explanation: source.explanation,
    selected: source.grounded,
  }));
}

/** Satu soal kosong yang belum disentuh (bawaan kuis baru) diganti, bukan ditambah di bawahnya. */
function isBlank(question: QuestionDraft): boolean {
  return !question.id && question.prompt.trim() === "" && question.options.every((option) => option.trim() === "");
}

function keptQuestions(questions: readonly QuestionDraft[]): readonly QuestionDraft[] {
  const [only] = questions;
  return questions.length === 1 && only && isBlank(only) ? [] : questions;
}

/** Sisa tempat di kuis untuk soal dari AI, dengan aturan MAX_QUESTIONS_PER_QUIZ yang sama dengan server. */
export function roomLeft(questions: readonly QuestionDraft[]): number {
  return Math.max(0, MAX_QUESTIONS_PER_QUIZ - keptQuestions(questions).length);
}

/** Draf yang dicentang jadi soal editor di akhir daftar. Origin dihitung lagi saat simpan (lihat aiSource). */
export function appendSelected(
  questions: readonly QuestionDraft[],
  drafts: readonly ReviewDraft[],
  makeKey: () => string,
): QuestionDraft[] {
  const added = drafts
    .filter((draft) => draft.selected)
    .map(
      (draft): QuestionDraft => ({
        key: makeKey(),
        prompt: draft.prompt,
        options: [...draft.options],
        correctIndex: draft.correctIndex,
        timeLimitSec: DEFAULT_TIME_LIMIT_SEC,
        explanation: draft.explanation,
        origin: deriveOrigin(draft.source, draft),
        aiSource: draft.source,
      }),
    );
  return [...keptQuestions(questions), ...added];
}

export type AiFlow =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "review"; drafts: ReviewDraft[] }
  | { kind: "added"; count: number; firstNumber: number }
  | {
      kind: "error";
      code: ApiErrorCode | null;
      message: string;
      /** Hanya AI_RATE_LIMITED: kapan hitung mundur dimulai (performance.now) dan berapa lama. */
      retry: { startedAt: number; durationMs: number } | null;
    };

export type AiState = {
  flow: AiFlow;
  /** Pesan AI_QUOTA_EXCEEDED. Bertahan sampai halaman dimuat ulang, apa pun langkah berikutnya. */
  quotaMessage: string | null;
};

export type ReviewEdit = Partial<Pick<ReviewDraft, "prompt" | "options" | "correctIndex" | "explanation" | "selected">>;

export type AiAction =
  | { type: "start" }
  | { type: "cancel" }
  | { type: "succeeded"; drafts: ReviewDraft[] }
  | { type: "failed"; code: ApiErrorCode | null; message: string; retryAfterSec: number | null; now: number }
  | { type: "edit"; key: string; patch: ReviewEdit }
  | { type: "added"; count: number; firstNumber: number }
  | { type: "discard" }
  | { type: "dismiss" };

export const initialAiState: AiState = { flow: { kind: "idle" }, quotaMessage: null };

/**
 * idle -> loading -> review -> added, atau loading -> error. Aksi yang datang di keadaan yang salah diabaikan:
 * misalnya respons yang tiba setelah guru menekan Batal, karena keadaannya sudah bukan loading lagi.
 */
export function aiReducer(state: AiState, action: AiAction): AiState {
  const { flow } = state;
  switch (action.type) {
    case "start":
      if (flow.kind === "loading" || state.quotaMessage) return state;
      return { ...state, flow: { kind: "loading" } };
    case "cancel":
      return flow.kind === "loading" ? { ...state, flow: { kind: "idle" } } : state;
    case "succeeded":
      return flow.kind === "loading" ? { ...state, flow: { kind: "review", drafts: action.drafts } } : state;
    case "failed": {
      if (flow.kind !== "loading") return state;
      const retry =
        action.code === "AI_RATE_LIMITED" && action.retryAfterSec !== null
          ? { startedAt: action.now, durationMs: action.retryAfterSec * 1000 }
          : null;
      return {
        flow: { kind: "error", code: action.code, message: action.message, retry },
        quotaMessage: action.code === "AI_QUOTA_EXCEEDED" ? action.message : state.quotaMessage,
      };
    }
    case "edit":
      if (flow.kind !== "review") return state;
      return {
        ...state,
        flow: { kind: "review", drafts: flow.drafts.map((draft) => (draft.key === action.key ? { ...draft, ...action.patch } : draft)) },
      };
    case "added":
      if (flow.kind !== "review" || action.count === 0) return state;
      return { ...state, flow: { kind: "added", count: action.count, firstNumber: action.firstNumber } };
    case "discard":
      return flow.kind === "review" ? { ...state, flow: { kind: "idle" } } : state;
    case "dismiss":
      return flow.kind === "error" || flow.kind === "added" ? { ...state, flow: { kind: "idle" } } : state;
  }
}
