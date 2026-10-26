import { z } from "zod";
import { AI_REQUEST_TIMEOUT_MS } from "@sorak/shared";
import type { ChatMessage, ResponseFormat } from "./prompt.ts";

export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_RETRY_AFTER_SEC = 30;

export type Usage = { inputTokens: number; outputTokens: number };

export type GroqResult =
  | { kind: "ok"; content: string; usage: Usage }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "failed"; reason: string };

// Hanya field yang dipakai. Respons Groq juga data dari luar, jadi bentuknya diperiksa.
const ChatCompletion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }),
});

/** Header retry-after Groq berisi detik. Nilai yang tidak terbaca diganti default, supaya web tetap bisa menghitung mundur. */
function retryAfterSec(header: string | null): number {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : DEFAULT_RETRY_AFTER_SEC;
}

export type GroqCredentials = { apiKey: string; model: string };
export type GroqPrompt = { messages: ChatMessage[]; responseFormat: ResponseFormat };

/**
 * Request ke Groq. Diekspor supaya skrip evaluasi (tools/ai-eval) mengirim request yang persis sama dengan Worker,
 * termasuk batas waktunya: jawaban yang lebih lambat dari itu juga gagal di produksi.
 */
export function groqRequestInit({ apiKey, model }: GroqCredentials, { messages, responseFormat }: GroqPrompt): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, response_format: responseFormat, temperature: 0.4 }),
    // Menunggu Groq adalah I/O, bukan CPU Worker; batas ini supaya guru tidak menunggu tanpa ujung.
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
  };
}

/** Isi jawaban dan pemakaian token dari body 200 Groq, atau null kalau bentuknya bukan chat completion. */
export function readCompletion(body: unknown): { content: string; usage: Usage } | null {
  const completion = ChatCompletion.safeParse(body);
  if (!completion.success) return null;
  const [choice] = completion.data.choices;
  if (!choice) return null;
  const { prompt_tokens, completion_tokens } = completion.data.usage;
  return { content: choice.message.content, usage: { inputTokens: prompt_tokens, outputTokens: completion_tokens } };
}

export async function callGroq(credentials: GroqCredentials, prompt: GroqPrompt): Promise<GroqResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_CHAT_URL, groqRequestInit(credentials, prompt));
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network";
    return { kind: "failed", reason };
  }

  if (res.status === 429) return { kind: "rate_limited", retryAfterSec: retryAfterSec(res.headers.get("retry-after")) };
  // Isi body error tidak dibaca ke log: cukup status, supaya pesan Groq tidak membawa data ke Workers Logs.
  if (!res.ok) return { kind: "failed", reason: `http_${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "failed", reason: "body_not_json" };
  }
  const completion = readCompletion(body);
  return completion ? { kind: "ok", ...completion } : { kind: "failed", reason: "unexpected_shape" };
}
