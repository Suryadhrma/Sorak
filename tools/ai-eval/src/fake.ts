import type { GroqPrompt } from "../../../apps/api/src/ai/groq.ts";
import type { RateInfo } from "./pacing.ts";
import { INJECTION_PHRASE } from "./report.ts";
import type { Material, Transport } from "./run.ts";

/**
 * Groq palsu untuk --dry-run. Tidak ada jaringan dan tidak ada waktu tunggu sungguhan: jam palsu maju sebesar
 * latency dan jeda, dan ember token per menit (8.000 TPM, seperti Free plan) dihitung terhadap jam itu.
 * Outputnya sengaja beragam supaya semua cabang laporan teruji: soal yang buktinya dikarang (tidak grounded),
 * satu output JSON rusak, dan satu 429 kalau pacing salah memperkirakan.
 */
export function fakeClock(start: number) {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const TPM = 8_000;

/** PRNG kecil (mulberry32) supaya --dry-run menghasilkan laporan yang sama setiap kali dijalankan. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function sentences(text: string): string[] {
  return text
    .replace(/^#.*$/gm, "")
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 200)
    // Groq palsu berperilaku seperti model yang tahan injeksi: kalimat perintah di materi tidak dijadikan soal.
    .filter((sentence) => !sentence.includes(INJECTION_PHRASE));
}

function fakeQuestions(material: Material, count: number) {
  const pool = sentences(material.text);
  return Array.from({ length: count }, (_, i) => {
    const evidence = pool[i % pool.length] ?? "";
    // Setiap soal keempat buktinya dikarang, seperti halusinasi: grounding check harus menandainya.
    const fabricated = i % 4 === 3;
    return {
      prompt: `(${material.name}) Pernyataan mana yang sesuai dengan materi, nomor ${i + 1}?`,
      options: [evidence.slice(0, 90), `Pengecoh pertama nomor ${i + 1}`, `Pengecoh kedua nomor ${i + 1}`, `Pengecoh ketiga nomor ${i + 1}`],
      correctIndex: 0,
      explanation: "Pilihan A dikutip langsung dari materi.",
      evidence: fabricated ? "Kalimat ini tidak pernah ditulis di materi mana pun." : evidence,
    };
  });
}

function rateInfo(remaining: number, refillMs: number, observedAt: number, retryAfterSec: number | null): RateInfo {
  return { remainingTokens: Math.floor(remaining), resetTokensMs: Math.ceil(refillMs), remainingRequests: 900, retryAfterSec, observedAt };
}

export function fakeTransport(materials: readonly Material[], clock: ReturnType<typeof fakeClock>): Transport {
  let tokens = TPM;
  let lastRefill = clock.now();
  const calls = new Map<string, number>();

  const refill = () => {
    const now = clock.now();
    tokens = Math.min(TPM, tokens + ((now - lastRefill) * TPM) / 60_000);
    lastRefill = now;
  };

  return async (prompt: GroqPrompt) => {
    const user = prompt.messages.find((message) => message.role === "user")?.content ?? "";
    // Dicocokkan persis dengan isi di antara penanda: materi pendek bisa menjadi bagian dari materi lain.
    const fenced = /<materi>\n([\s\S]*)\n<\/materi>/.exec(user)?.[1];
    const material = materials.find((m) => m.text === fenced);
    const count = Number(/Buat tepat (\d+) soal/.exec(user)?.[1] ?? 10);
    if (!material) return { kind: "error", reason: "fake_unknown_material" };
    const call = (calls.get(material.name) ?? 0) + 1;
    calls.set(material.name, call);

    const inputTokens = Math.ceil(user.length / 3.5) + 900;
    const outputTokens = count * 260;
    refill();
    if (tokens < inputTokens + outputTokens) {
      const retryAfterSec = Math.ceil(((inputTokens + outputTokens - tokens) * 60) / TPM);
      return { kind: "response", status: 429, body: { error: { message: "Rate limit reached" } }, rate: rateInfo(tokens, ((TPM - tokens) * 60_000) / TPM, clock.now(), retryAfterSec) };
    }
    tokens -= inputTokens + outputTokens;
    clock.advance(3_000 + ((material.text.length * 7 + call * 1_300) % 4_000));

    // Percobaan kedua materi ketiga mengembalikan JSON terpotong, supaya cabang gagal skema ikut teruji.
    const broken = material === materials[2] && call === 2;
    const content = broken ? '{"questions": [{"prompt": "terpotong' : JSON.stringify({ questions: fakeQuestions(material, count) });
    return {
      kind: "response",
      status: 200,
      body: {
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      },
      rate: rateInfo(tokens, ((TPM - tokens) * 60_000) / TPM, clock.now(), null),
    };
  };
}
