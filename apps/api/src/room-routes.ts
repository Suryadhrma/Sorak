import { Hono, type Context } from "hono";
import {
  CreateRoomInput,
  PIN_CREATE_ATTEMPTS,
  Pin,
  fieldErrors,
  type Host,
  type QuizDetail,
  type QuizSnapshot,
  type RoomLookup,
} from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { log } from "./log.ts";
import { newPin } from "./pin.ts";
import { findQuiz } from "./quizzes.ts";
import { connectRequest, getJoinInfo, initRoom, roomStub } from "./room-control.ts";
import { requireHost } from "./session.ts";

type RoomEnv = { Bindings: Env; Variables: { host: Host } };

export const roomRoutes = new Hono<RoomEnv>();
export const wsRoutes = new Hono<RoomEnv>();

const roomNotFound = (c: Context) => apiError(c, 404, "NOT_FOUND", "Room tidak ditemukan");

/**
 * Batas tebakan PIN per IP (ADR 0005). Satu WiFi sekolah terlihat sebagai satu IP, karena itu batasnya longgar.
 * Tanpa CF-Connecting-IP (hanya terjadi di luar jaringan Cloudflare) semua request berbagi satu kunci.
 */
async function allowPinLookup(c: Context<RoomEnv>): Promise<boolean> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.PIN_LOOKUP.limit({ key: ip });
  return success;
}

const rateLimited = (c: Context) => apiError(c, 429, "RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi sebentar.");

/** Kuis dari D1 jadi salinan soal di GameRoom. Gambar soal belum ada. */
function toQuizSnapshot(quiz: QuizDetail): QuizSnapshot {
  return {
    quizId: quiz.id,
    title: quiz.title,
    questions: quiz.questions.map((question) => ({
      questionId: question.id,
      prompt: question.prompt,
      options: question.options,
      correctIndex: question.correctIndex,
      timeLimitSec: question.timeLimitSec,
      imageUrl: null,
    })),
  };
}

roomRoutes.post("/", requireHost, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) return apiError(c, 400, "VALIDATION_FAILED", "Body bukan JSON yang valid");
    throw error;
  }
  const input = CreateRoomInput.safeParse(body);
  if (!input.success) return apiError(c, 400, "VALIDATION_FAILED", "Kuis belum dipilih", fieldErrors(input.error.issues));

  // Kuis milik host lain dijawab sama dengan kuis yang tidak ada.
  const quiz = await findQuiz(c.env.DB, c.var.host.id, input.data.quizId);
  if (!quiz) return apiError(c, 404, "NOT_FOUND", "Kuis tidak ditemukan");
  if (quiz.questions.length === 0) return apiError(c, 409, "CONFLICT", "Tambahkan minimal satu soal");

  const room = {
    gameId: crypto.randomUUID(),
    hostId: c.var.host.id,
    scoringMode: input.data.scoringMode,
    // Mode tim belum bisa dipilih; pilihannya ditambahkan di hari fitur itu dibuat.
    teamMode: false,
    quiz: toQuizSnapshot(quiz),
  };
  for (let attempt = 1; attempt <= PIN_CREATE_ATTEMPTS; attempt++) {
    const pin = newPin();
    const result = await initRoom(roomStub(c.env, pin), { ...room, pin });
    if (result.ok) return c.json({ pin }, 201);
  }
  // Peluangnya mendekati nol selama room aktif jauh lebih sedikit dari 1.000.000 PIN.
  log.error("pin_attempts_exhausted", { attempts: PIN_CREATE_ATTEMPTS });
  return apiError(c, 500, "INTERNAL", "Gagal membuat room. Coba lagi.");
});

roomRoutes.get("/:pin", async (c) => {
  if (!(await allowPinLookup(c))) return rateLimited(c);
  const pin = Pin.safeParse(c.req.param("pin"));
  if (!pin.success) return roomNotFound(c);

  const info = await getJoinInfo(roomStub(c.env, pin.data));
  switch (info.status) {
    case "open":
      return c.json({ pin: pin.data, playerCount: info.playerCount } satisfies RoomLookup);
    case "not_found":
      return roomNotFound(c);
    case "started":
      return apiError(c, 409, "GAME_ALREADY_STARTED", "Permainan sudah dimulai");
    case "full":
      return apiError(c, 409, "ROOM_FULL", "Room sudah penuh");
    default:
      return info.status satisfies never;
  }
});

// Jalur pemain tanpa cek Origin: tidak memakai cookie, dan load tester Go tidak mengirim Origin.
wsRoutes.get("/play/:pin", async (c) => {
  if (!(await allowPinLookup(c))) return rateLimited(c);
  const pin = Pin.safeParse(c.req.param("pin"));
  if (!pin.success) return roomNotFound(c);
  if (c.req.header("Upgrade") !== "websocket") return c.body(null, 426);
  return roomStub(c.env, pin.data).fetch(connectRequest(c.req.raw, "play", null));
});

wsRoutes.get(
  "/host/:pin",
  // Cross-Site WebSocket Hijacking: situs lain membuka WebSocket memakai cookie guru yang sedang login.
  // SameSite=Lax sudah menahan sebagian besar kasus; cek Origin adalah lapis kedua.
  async (c, next) => {
    if (c.req.header("Origin") !== c.env.APP_ORIGIN) return apiError(c, 403, "FORBIDDEN", "Origin tidak diizinkan");
    await next();
  },
  requireHost,
  async (c) => {
    const pin = Pin.safeParse(c.req.param("pin"));
    if (!pin.success) return roomNotFound(c);
    if (c.req.header("Upgrade") !== "websocket") return c.body(null, 426);
    return roomStub(c.env, pin.data).fetch(connectRequest(c.req.raw, "host", c.var.host.id));
  },
);
