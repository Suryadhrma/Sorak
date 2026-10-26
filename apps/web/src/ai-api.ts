import { AiDraftResponse, ApiError, type AiGenerateFromTextInput } from "@sorak/shared";
import { ApiRequestError } from "./api.ts";

/** ApiRequestError ditambah retryAfterSec, yang hanya dikirim server untuk AI_RATE_LIMITED. */
export class AiRequestError extends ApiRequestError {
  constructor(
    status: number,
    code: ApiRequestError["code"],
    message: string,
    fields: Record<string, string>,
    readonly retryAfterSec: number | null,
  ) {
    super(status, code, message, fields);
    this.name = "AiRequestError";
  }
}

/**
 * Tidak lewat send() di api.ts: api.ts ikut terunduh di HP siswa, sedangkan retryAfterSec hanya dibutuhkan di sini.
 * Abort dari tombol Batal diteruskan apa adanya (DOMException AbortError), bukan diubah jadi error jaringan.
 */
export async function generateDrafts(input: AiGenerateFromTextInput, signal: AbortSignal): Promise<AiDraftResponse> {
  let res: Response;
  try {
    res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AiRequestError(0, null, "Tidak bisa terhubung ke server. Periksa koneksi internet.", {}, null);
  }
  if (res.ok) return AiDraftResponse.parse(await res.json());

  const body = ApiError.safeParse(await res.json().catch(() => null));
  if (body.success) {
    const { code, message, fields, retryAfterSec } = body.data.error;
    throw new AiRequestError(res.status, code, message, fields ?? {}, retryAfterSec ?? null);
  }
  throw new AiRequestError(res.status, null, `Server menjawab ${res.status}. Coba lagi sebentar lagi.`, {}, null);
}
