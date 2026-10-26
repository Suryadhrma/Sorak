import { z } from "zod";
import { AI_REQUEST_TIMEOUT_MS } from "@sorak/shared";
import type { ChatMessage, ResponseFormat } from "./prompt.ts";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
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

export async function callGroq(
  { apiKey, model }: { apiKey: string; model: string },
  { messages, responseFormat }: { messages: ChatMessage[]; responseFormat: ResponseFormat },
): Promise<GroqResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, response_format: responseFormat, temperature: 0.4 }),
      // Menunggu Groq adalah I/O, bukan CPU Worker; batas ini supaya guru tidak menunggu tanpa ujung.
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
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
  const completion = ChatCompletion.safeParse(body);
  if (!completion.success) return { kind: "failed", reason: "unexpected_shape" };
  const [choice] = completion.data.choices;
  if (!choice) return { kind: "failed", reason: "unexpected_shape" };
  const { prompt_tokens, completion_tokens } = completion.data.usage;
  return { kind: "ok", content: choice.message.content, usage: { inputTokens: prompt_tokens, outputTokens: completion_tokens } };
}
