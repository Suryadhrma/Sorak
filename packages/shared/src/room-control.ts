import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM } from "./constants.ts";
import { GameId, Pin, ScoringMode } from "./primitives.ts";
import { QuizSnapshot } from "./room-storage.ts";

/**
 * Kontrak Worker "sorak" ke GameRoom di Worker "sorak-realtime", lewat fetch internal.
 * Bukan RPC: tipe Durable Object lintas Worker bentrok dengan Env masing-masing Worker (ADR 0004).
 *
 * Kedua Worker di-deploy terpisah, jadi sesaat versinya bisa berbeda (version skew).
 * Karena itu kedua sisi memvalidasi dengan skema ini, dan dipakai z.object biasa:
 * field baru dari versi yang lebih baru cukup diabaikan versi lama.
 */

/** URL internal tetap. Worker tidak pernah meneruskan URL dari klien ke GameRoom. */
export const ROOM_CONTROL_ORIGIN = "https://room";

export const RoomControlPath = {
  init: "/init",
  joinInfo: "/join-info",
  connect: "/connect",
} as const;

/** Diisi ulang Worker untuk setiap upgrade; header dengan nama sama dari klien dibuang. */
export const RoomHeader = {
  route: "X-Sorak-Route",
  hostId: "X-Sorak-Host-Id",
} as const;

export const RoomRoute = z.enum(["play", "host"]);
export type RoomRoute = z.infer<typeof RoomRoute>;

export const InitRoomInput = z.object({
  gameId: GameId,
  hostId: z.string().min(1),
  pin: Pin,
  scoringMode: ScoringMode,
  teamMode: z.boolean(),
  quiz: QuizSnapshot,
});
export type InitRoomInput = z.infer<typeof InitRoomInput>;

export const InitRoomResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.literal("pin_in_use") }),
]);
export type InitRoomResult = z.infer<typeof InitRoomResult>;

export const JoinInfo = z.object({
  status: z.enum(["open", "not_found", "started", "full"]),
  playerCount: z.number().int().min(0).max(MAX_PLAYERS_PER_ROOM),
});
export type JoinInfo = z.infer<typeof JoinInfo>;
