import { describe, expect, it } from "vitest";
import {
  AI_EVIDENCE_MAX_CHARS,
  AI_QUESTION_COUNTS,
  AI_SOURCE_MAX_CHARS,
  AI_SOURCE_MIN_CHARS,
  AiDraftQuestion,
  AiDraftResponse,
  AiGenerateFromTextInput,
  ApiError,
  ApiErrorCode,
  OPTION_MAX_LENGTH,
  QuestionDetail,
  QuestionInput,
  normalizeText,
} from "../src/index.ts";

const source = "Sel adalah unit terkecil penyusun makhluk hidup. ".repeat(6);

const draft = (extra: Record<string, unknown> = {}) => ({
  prompt: "Apa unit terkecil penyusun makhluk hidup?",
  options: ["Sel", "Jaringan", "Organ", "Sistem organ"],
  correctIndex: 0,
  explanation: "Materi menyebut sel sebagai unit terkecil penyusun makhluk hidup.",
  evidence: "Sel adalah unit terkecil penyusun makhluk hidup.",
  ...extra,
});

describe("AiGenerateFromTextInput", () => {
  it("menerima materi dengan panjang yang sah dan jumlah soal 5 atau 10, setelah di-trim", () => {
    for (const count of AI_QUESTION_COUNTS) {
      const result = AiGenerateFromTextInput.safeParse({ sourceText: `  ${source}  `, count });
      expect(result.success).toBe(true);
      expect(result.data?.sourceText).toBe(source.trim());
    }
  });

  it(`menolak materi di bawah ${AI_SOURCE_MIN_CHARS} atau di atas ${AI_SOURCE_MAX_CHARS} huruf`, () => {
    expect(AiGenerateFromTextInput.safeParse({ sourceText: "a".repeat(AI_SOURCE_MIN_CHARS - 1), count: 5 }).success).toBe(false);
    expect(AiGenerateFromTextInput.safeParse({ sourceText: "a".repeat(AI_SOURCE_MAX_CHARS + 1), count: 5 }).success).toBe(false);
    // Spasi di tepi tidak dihitung: materi pendek tidak bisa lolos dengan menambah spasi.
    expect(AiGenerateFromTextInput.safeParse({ sourceText: ` ${"a".repeat(AI_SOURCE_MIN_CHARS - 1)} `, count: 5 }).success).toBe(false);
  });

  it("menolak jumlah soal selain 5 atau 10", () => {
    expect(AiGenerateFromTextInput.safeParse({ sourceText: source, count: 7 }).success).toBe(false);
  });
});

describe("AiDraftQuestion", () => {
  it("menerima draf yang valid", () => {
    expect(AiDraftQuestion.safeParse(draft()).success).toBe(true);
  });

  it("wajib tepat 4 pilihan, masing-masing tidak kosong dan tidak lebih dari batas opsi", () => {
    expect(AiDraftQuestion.safeParse(draft({ options: ["Sel", "Jaringan", "Organ"] })).success).toBe(false);
    expect(AiDraftQuestion.safeParse(draft({ options: ["Sel", "Jaringan", "Organ", " "] })).success).toBe(false);
    expect(AiDraftQuestion.safeParse(draft({ options: ["Sel", "Jaringan", "Organ", "x".repeat(OPTION_MAX_LENGTH + 1)] })).success).toBe(
      false,
    );
  });

  it("menolak pilihan kembar setelah dinormalisasi (huruf besar dan spasi tidak membedakan)", () => {
    const result = AiDraftQuestion.safeParse(draft({ options: ["Sel", "Jaringan", "  sel ", "Organ"] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["options"]);
  });

  it("menolak correctIndex di luar 0-3", () => {
    expect(AiDraftQuestion.safeParse(draft({ correctIndex: 4 })).success).toBe(false);
    expect(AiDraftQuestion.safeParse(draft({ correctIndex: -1 })).success).toBe(false);
  });

  it(`penjelasan paling panjang 300 huruf dan bukti paling panjang ${AI_EVIDENCE_MAX_CHARS} huruf`, () => {
    expect(AiDraftQuestion.safeParse(draft({ explanation: "x".repeat(301) })).success).toBe(false);
    expect(AiDraftQuestion.safeParse(draft({ evidence: "x".repeat(AI_EVIDENCE_MAX_CHARS + 1) })).success).toBe(false);
  });
});

describe("AiDraftResponse", () => {
  it("membawa draf beserta tanda grounded, model, dan versi prompt", () => {
    const response = { drafts: [{ ...draft(), grounded: true }], model: "openai/gpt-oss-120b", promptVersion: "gen-text-v1" };
    expect(AiDraftResponse.safeParse(response).success).toBe(true);
    expect(AiDraftResponse.safeParse({ ...response, drafts: [draft()] }).success).toBe(false);
  });
});

describe("normalizeText", () => {
  it("NFKC, huruf kecil, spasi beruntun jadi satu, dan tanda kutip lengkung jadi lurus", () => {
    expect(normalizeText("  “Sel”   ADALAH\n\tunit ‘terkecil’ ")).toBe("\"sel\" adalah unit 'terkecil'");
    expect(normalizeText("ＡＢＣ")).toBe("abc");
  });
});

describe("origin soal", () => {
  const base = { prompt: "Ibu kota?", options: ["Jakarta", "Bandung"], correctIndex: 0, timeLimitSec: 20, explanation: null };

  it("input tanpa origin dianggap manual (klien lama tetap bisa menyimpan)", () => {
    expect(QuestionInput.parse(base).origin).toBe("manual");
  });

  it("input menerima origin ai dan ai_edited, menolak nilai lain", () => {
    expect(QuestionInput.parse({ ...base, origin: "ai" }).origin).toBe("ai");
    expect(QuestionInput.parse({ ...base, origin: "ai_edited" }).origin).toBe("ai_edited");
    expect(QuestionInput.safeParse({ ...base, origin: "robot" }).success).toBe(false);
  });

  it("detail soal wajib membawa origin", () => {
    const id = "6f1c2c3e-7c4b-4a3a-9d2f-1b2c3d4e5f60";
    expect(QuestionDetail.safeParse({ ...base, id }).success).toBe(false);
    expect(QuestionDetail.safeParse({ ...base, id, origin: "ai" }).success).toBe(true);
  });
});

describe("kode error AI", () => {
  it.each(["AI_UNAVAILABLE", "AI_QUOTA_EXCEEDED", "AI_RATE_LIMITED", "AI_INVALID_OUTPUT"])("ApiErrorCode mengenal %s", (code) => {
    expect(ApiErrorCode.safeParse(code).success).toBe(true);
  });

  it("AI_RATE_LIMITED membawa retryAfterSec supaya web bisa menghitung mundur", () => {
    const body = { error: { code: "AI_RATE_LIMITED", message: "Server AI sedang sibuk.", retryAfterSec: 30 } };
    expect(ApiError.parse(body).error.retryAfterSec).toBe(30);
  });
});
