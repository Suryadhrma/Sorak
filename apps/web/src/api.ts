import type { z } from "zod";
import {
  ApiError,
  CreateRoomResult,
  Host,
  QuizDetail,
  QuizSummary,
  RoomLookup,
  type ApiErrorCode,
  type CreateRoomInput,
  type QuizInput,
} from "@sorak/shared";

/**
 * Semua panggilan REST lewat modul ini. Respons divalidasi dengan skema shared,
 * dan kegagalan selalu dilempar sebagai ApiRequestError supaya halaman cukup memeriksa `code`.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    /** Null kalau server tidak menjawab dengan ApiError (jaringan putus, atau respons tak terduga). */
    readonly code: ApiErrorCode | null,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin" });
  } catch {
    // fetch hanya menolak saat jaringan gagal; diteruskan sebagai error bertipe yang bisa ditampilkan.
    throw new ApiRequestError(0, null, "Tidak bisa terhubung ke server. Periksa koneksi internet.");
  }
  if (res.ok) return res;

  const body = ApiError.safeParse(await res.json().catch(() => null));
  if (body.success) {
    const { code, message, fields } = body.data.error;
    throw new ApiRequestError(res.status, code, message, fields);
  }
  throw new ApiRequestError(res.status, null, `Server menjawab ${res.status}. Coba lagi sebentar lagi.`);
}

async function sendJson<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  return schema.parse(await res.json());
}

const jsonBody = (method: "POST" | "PUT", input: QuizInput | CreateRoomInput): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});

export const getMe = () => sendJson("/api/me", Host);

export const listQuizzes = () => sendJson("/api/quizzes", QuizSummary.array());

export const getQuiz = (id: string) => sendJson(`/api/quizzes/${encodeURIComponent(id)}`, QuizDetail);

export const createQuiz = (input: QuizInput) => sendJson("/api/quizzes", QuizDetail, jsonBody("POST", input));

export const updateQuiz = (id: string, input: QuizInput) =>
  sendJson(`/api/quizzes/${encodeURIComponent(id)}`, QuizDetail, jsonBody("PUT", input));

export const createRoom = (input: CreateRoomInput) => sendJson("/api/rooms", CreateRoomResult, jsonBody("POST", input));

/** Cek PIN sebelum membuka WebSocket, supaya PIN salah atau room penuh dijelaskan dengan pesan yang jelas. */
export const lookupRoom = (pin: string) => sendJson(`/api/rooms/${encodeURIComponent(pin)}`, RoomLookup);

export async function deleteQuiz(id: string): Promise<void> {
  await send(`/api/quizzes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function logout(): Promise<void> {
  await send("/api/auth/logout", { method: "POST" });
}

/** Pesan untuk ditampilkan ke guru dari error apa pun yang dilempar modul ini. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "Terjadi kesalahan tak terduga. Muat ulang halaman lalu coba lagi.";
}
