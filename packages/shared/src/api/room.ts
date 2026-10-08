import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM } from "../constants.ts";
import { Pin } from "../primitives.ts";
import { QuizId } from "./quiz.ts";

/**
 * Skema REST room. Mode skor dan mode tim belum bisa dipilih: Worker memakai classic tanpa tim,
 * dan pilihannya ditambahkan di hari fitur itu dibuat supaya tidak ada opsi yang belum berfungsi.
 */

export const CreateRoomInput = z.object({ quizId: QuizId });
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export const CreateRoomResult = z.object({ pin: Pin });
export type CreateRoomResult = z.infer<typeof CreateRoomResult>;

/** Jawaban cek PIN untuk siswa: room ada dan masih menerima pemain. */
export const RoomLookup = z.object({
  pin: Pin,
  playerCount: z.number().int().min(0).max(MAX_PLAYERS_PER_ROOM),
});
export type RoomLookup = z.infer<typeof RoomLookup>;
