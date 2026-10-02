import type { z } from "zod";
import { MAX_CLIENT_MESSAGE_BYTES } from "./constants.ts";
import { HostMessage, PlayerMessage, type ClientMessage } from "./client-messages.ts";
import { HostServerMessage, PlayerServerMessage, type ServerMessage } from "./server-messages.ts";

/**
 * Codec = encoder + decoder: mengubah objek jadi teks untuk dikirim,
 * dan teks yang diterima kembali jadi objek yang sudah divalidasi.
 *
 * Urutan pengecekan sengaja dari yang paling murah ke paling mahal:
 * jenis data → ukuran → JSON.parse → validasi skema.
 * Pesan raksasa atau sampah ditolak sebelum memakan CPU.
 */

export type DecodeFailure = "binary" | "too_large" | "invalid_json" | "invalid_schema";

export type DecodeResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: DecodeFailure; detail?: string };

const encoder = new TextEncoder();

function byteLength(text: string): number {
  // Setiap karakter UTF-16 paling banyak 3 byte UTF-8; lewati encode kalau pasti aman.
  if (text.length * 3 <= MAX_CLIENT_MESSAGE_BYTES) return text.length;
  return encoder.encode(text).byteLength;
}

function decodeWith<T>(schema: z.ZodType<T>, raw: unknown, maxBytes: number | null): DecodeResult<T> {
  if (typeof raw !== "string") return { ok: false, reason: "binary" };
  if (maxBytes !== null && (raw.length > maxBytes || byteLength(raw) > maxBytes)) {
    return { ok: false, reason: "too_large" };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, reason: "invalid_schema", detail };
  }
  return { ok: true, data: result.data };
}

/** Dipakai GameRoom untuk pesan dari HP pemain. */
export function decodePlayerMessage(raw: unknown): DecodeResult<PlayerMessage> {
  return decodeWith(PlayerMessage, raw, MAX_CLIENT_MESSAGE_BYTES);
}

/** Dipakai GameRoom untuk pesan dari layar host. */
export function decodeHostMessage(raw: unknown): DecodeResult<HostMessage> {
  return decodeWith(HostMessage, raw, MAX_CLIENT_MESSAGE_BYTES);
}

/**
 * Dipakai web untuk pesan dari server. Tanpa batas ukuran (server dipercaya),
 * dan tipe yang tidak dikenal menghasilkan ok:false yang cukup diabaikan,
 * sehingga web versi lama tidak rusak saat server menambah jenis pesan baru.
 */
export function decodePlayerServerMessage(raw: unknown): DecodeResult<PlayerServerMessage> {
  return decodeWith(PlayerServerMessage, raw, null);
}

export function decodeHostServerMessage(raw: unknown): DecodeResult<HostServerMessage> {
  return decodeWith(HostServerMessage, raw, null);
}

/**
 * Encode tidak memvalidasi ulang demi kecepatan: tipe TypeScript sudah menjamin bentuknya
 * saat kompilasi. Test memvalidasi contoh pesan supaya tipe dan skema tetap sejalan.
 */
export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}
