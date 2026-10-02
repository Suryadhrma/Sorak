import { z } from "zod";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS_PER_QUIZ,
  MIN_OPTIONS,
  NICKNAME_MAX_LENGTH,
  OPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  TEAM_SIZE_MAX,
  TIME_LIMIT_MAX_SEC,
} from "./constants.ts";

/**
 * Potongan kecil yang dipakai ulang di banyak skema.
 * Setiap skema juga mengekspor tipe TypeScript-nya lewat z.infer,
 * jadi aturan validasi dan tipe tidak pernah berbeda.
 */

export const Pin = z.string().regex(/^\d{6}$/, "PIN harus 6 digit angka");
export type Pin = z.infer<typeof Pin>;

export const PlayerId = z.string().min(1).max(40);
export type PlayerId = z.infer<typeof PlayerId>;

export const GameId = z.uuid();
export type GameId = z.infer<typeof GameId>;

/** 128 bit acak dalam base64url = 22 karakter. */
export const SessionToken = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, "Session token tidak valid");
export type SessionToken = z.infer<typeof SessionToken>;

export const QuestionIndex = z.number().int().min(0).max(MAX_QUESTIONS_PER_QUIZ - 1);
export type QuestionIndex = z.infer<typeof QuestionIndex>;

export const ChoiceIndex = z.number().int().min(0).max(MAX_OPTIONS - 1);
export type ChoiceIndex = z.infer<typeof ChoiceIndex>;

/** Tingkat yakin di mode Taruhan Yakin: 1 ragu, 2 cukup yakin, 3 sangat yakin. */
export const Confidence = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Confidence = z.infer<typeof Confidence>;

export const ElapsedMs = z.number().int().min(0).max(TIME_LIMIT_MAX_SEC * 1000);

export const TeamSize = z.number().int().min(1).max(TEAM_SIZE_MAX);

export const ScoringMode = z.enum(["classic", "accurate", "confidence"]);
export type ScoringMode = z.infer<typeof ScoringMode>;

/** Tahap yang terlihat oleh klien. CLOSED tidak perlu dikirim karena socket langsung ditutup. */
export const Phase = z.enum(["lobby", "question", "grace", "reveal", "ended"]);
export type Phase = z.infer<typeof Phase>;

export const Prompt = z.string().min(1).max(PROMPT_MAX_LENGTH);
export const Options = z.array(z.string().min(1).max(OPTION_MAX_LENGTH)).min(MIN_OPTIONS).max(MAX_OPTIONS);

/**
 * Nickname:
 * 1. Dinormalisasi NFKC (huruf "lebar" dan varian Unicode disamakan), di-trim,
 *    dan spasi beruntun dirapikan jadi satu.
 * 2. Hanya huruf, angka, spasi, titik, garis bawah, dan strip.
 *    Emoji, karakter tak terlihat (zero-width), dan karakter kontrol ditolak,
 *    supaya tidak ada "Dimas" palsu yang terlihat sama di layar.
 */
export const Nickname = z
  .string()
  .max(NICKNAME_MAX_LENGTH * 4)
  .transform((value) => value.normalize("NFKC").trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Nickname tidak boleh kosong")
      .max(NICKNAME_MAX_LENGTH, `Nickname maksimal ${NICKNAME_MAX_LENGTH} karakter`)
      .regex(/^[\p{L}\p{N} ._-]+$/u, "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -"),
  );
export type Nickname = z.infer<typeof Nickname>;

/**
 * Kunci pembanding nickname kembar: "Dimas", "dimas", dan "DIMAS" dianggap sama.
 * Dipakai server saat mengecek duplikat, bukan untuk ditampilkan.
 */
export function nicknameKey(nickname: string): string {
  return nickname.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}
