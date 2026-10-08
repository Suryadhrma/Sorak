import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM } from "../constants.ts";
import { Pin, ScoringMode } from "../primitives.ts";
import { QuizId } from "./quiz.ts";

/**
 * Skema REST room. Hanya mode yang sudah berfungsi yang bisa dipilih: Taruhan Yakin (confidence)
 * dan mode tim ditambahkan di hari fitur itu dibuat.
 */

export const CreateRoomInput = z.object({
  quizId: QuizId,
  scoringMode: ScoringMode.extract(["classic", "accurate"]),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export const CreateRoomResult = z.object({ pin: Pin });
export type CreateRoomResult = z.infer<typeof CreateRoomResult>;

/** Jawaban cek PIN untuk siswa: room ada dan masih menerima pemain. */
export const RoomLookup = z.object({
  pin: Pin,
  playerCount: z.number().int().min(0).max(MAX_PLAYERS_PER_ROOM),
});
export type RoomLookup = z.infer<typeof RoomLookup>;
