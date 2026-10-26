import type { AiDraft } from "@sorak/shared";
import { readCompletion, type GroqPrompt } from "../../../apps/api/src/ai/groq.ts";
import { buildTextPrompt } from "../../../apps/api/src/ai/prompt.ts";
import { parseDrafts } from "../../../apps/api/src/ai/validate.ts";
import { waitAfterRateLimit, waitBeforeRequest, type RateInfo } from "./pacing.ts";

export type Material = { name: string; text: string };

export type TransportResult =
  | { kind: "response"; status: number; body: unknown; rate: RateInfo }
  | { kind: "error"; reason: string };

/** Satu panggilan ke Groq. Asli (fetch) atau palsu (--dry-run); sisanya sama persis. */
export type Transport = (prompt: GroqPrompt) => Promise<TransportResult>;

export type Attempt = {
  material: string;
  run: number;
  /** Groq menjawab 200 dengan chat completion; hanya ini yang dihitung dalam persen lolos skema. */
  completed: boolean;
  passed: boolean;
  /** Alasan gagal: dari parseDrafts (invalid_json, invalid_schema, ...) atau dari penyedia (http_500, timeout, ...). */
  reason: string | null;
  detail: string | null;
  questions: number;
  grounded: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  retries: number;
  drafts: AiDraft[];
};

export type RunOptions = {
  materials: Material[];
  runs: number;
  count: 5 | 10;
  transport: Transport;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
};

export type RunResult = { attempts: Attempt[]; waitedMs: number; stoppedEarly: string | null };

const MAX_RATE_LIMIT_RETRIES = 5;
// Perkiraan awal satu permintaan 10 soal (input + output); diganti angka nyata terbesar setelah respons pertama.
const INITIAL_TOKEN_ESTIMATE = 5_000;

/**
 * Kode dan pesan error Groq untuk laporan evaluasi (materinya milik kita sendiri, jadi aman dicatat, tidak seperti
 * log Worker). failed_generation tidak diambil: bisa sangat panjang.
 */
export function providerDetail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const { error } = body;
  if (typeof error !== "object" || error === null) return null;
  const parts: string[] = [];
  if ("code" in error && typeof error.code === "string") parts.push(`code=${error.code}`);
  if ("schema_path" in error && typeof error.schema_path === "string") parts.push(`schema_path=${error.schema_path}`);
  if ("message" in error && typeof error.message === "string") parts.push(`message=${error.message.slice(0, 300)}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} dtk`;

/**
 * Setiap materi diminta `runs` kali. Urutannya per putaran (semua materi, lalu ulang), supaya percobaan materi
 * yang sama tersebar di waktu yang berbeda. Jeda mengikuti header rate limit Groq; 429 diulang dengan permintaan
 * yang sama setelah menunggu.
 */
export async function runEval(options: RunOptions): Promise<RunResult> {
  const { materials, runs, count, transport, sleep, now, log } = options;
  const attempts: Attempt[] = [];
  const total = materials.length * runs;
  let rate: RateInfo | null = null;
  let estimate = INITIAL_TOKEN_ESTIMATE;
  let waitedMs = 0;

  const wait = async (ms: number, why: string) => {
    if (ms <= 0) return;
    log(`  menunggu ${seconds(ms)} (${why})`);
    waitedMs += ms;
    await sleep(ms);
  };

  for (let run = 1; run <= runs; run++) {
    for (const material of materials) {
      if (rate?.remainingRequests === 0) {
        return { attempts, waitedMs, stoppedEarly: "Jatah permintaan harian Groq habis (x-ratelimit-remaining-requests = 0)." };
      }
      const prompt = buildTextPrompt({ sourceText: material.text, count });
      const attempt: Attempt = {
        material: material.name,
        run,
        completed: false,
        passed: false,
        reason: null,
        detail: null,
        questions: 0,
        grounded: 0,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        retries: 0,
        drafts: [],
      };

      for (;;) {
        await wait(waitBeforeRequest(rate, estimate, now()), "sisa token per menit belum cukup");
        const startedAt = now();
        const result = await transport(prompt);
        attempt.latencyMs = now() - startedAt;

        if (result.kind === "error") {
          attempt.reason = result.reason;
          break;
        }
        rate = result.rate;
        if (result.status === 429 && attempt.retries < MAX_RATE_LIMIT_RETRIES) {
          attempt.retries++;
          await wait(waitAfterRateLimit(result.rate), "Groq menjawab 429, permintaan yang sama diulang");
          // retry-after sudah ditunggu; sisa token di header 429 itu sudah basi, jangan dipakai untuk menunggu lagi.
          rate = { ...result.rate, remainingTokens: null };
          continue;
        }
        if (result.status !== 200) {
          attempt.reason = `http_${result.status}`;
          attempt.detail = providerDetail(result.body);
          break;
        }
        const completion = readCompletion(result.body);
        if (!completion) {
          attempt.reason = "unexpected_shape";
          break;
        }
        attempt.completed = true;
        attempt.inputTokens = completion.usage.inputTokens;
        attempt.outputTokens = completion.usage.outputTokens;
        estimate = Math.max(estimate, completion.usage.inputTokens + completion.usage.outputTokens);

        const parsed = parseDrafts(completion.content, { count, sourceText: material.text });
        if (parsed.ok) {
          attempt.passed = true;
          attempt.drafts = parsed.drafts;
          attempt.questions = parsed.drafts.length;
          attempt.grounded = parsed.drafts.filter((draft) => draft.grounded).length;
        } else {
          attempt.reason = parsed.reason;
          attempt.detail = parsed.detail;
        }
        break;
      }

      attempts.push(attempt);
      const status = attempt.passed
        ? `lolos, ${attempt.grounded}/${attempt.questions} grounded`
        : `gagal (${attempt.reason ?? "?"})`;
      const tokens = attempt.inputTokens === null ? "" : `, ${attempt.inputTokens + (attempt.outputTokens ?? 0)} token`;
      log(`[${attempts.length}/${total}] ${material.name} percobaan ${run}: ${status}${tokens}, ${seconds(attempt.latencyMs ?? 0)}`);
    }
  }
  return { attempts, waitedMs, stoppedEarly: null };
}
