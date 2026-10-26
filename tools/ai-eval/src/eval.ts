import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { AI_PROMPT_VERSION } from "@sorak/shared";
import { GROQ_CHAT_URL, groqRequestInit } from "../../../apps/api/src/ai/groq.ts";
import { fakeClock, fakeTransport, seededRandom } from "./fake.ts";
import { readRateInfo } from "./pacing.ts";
import { buildMarkdown, pickSamples, summarize } from "./report.ts";
import { runEval, type Material, type Transport } from "./run.ts";

const USAGE = "Pemakaian: pnpm --filter ai-eval run eval [--dry-run] [--runs=3] [--count=5|10] [--only=01,06]";

const root = new URL("../", import.meta.url);
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** ID model diambil dari vars Worker supaya evaluasi selalu memakai model yang sama dengan produksi. */
async function textModel(): Promise<string> {
  if (process.env.GROQ_TEXT_MODEL) return process.env.GROQ_TEXT_MODEL;
  const wrangler = await readFile(new URL("../../apps/api/wrangler.jsonc", root), "utf8");
  const match = /"GROQ_TEXT_MODEL"\s*:\s*"([^"]+)"/.exec(wrangler);
  if (!match?.[1]) throw new Error("GROQ_TEXT_MODEL tidak ditemukan di apps/api/wrangler.jsonc");
  return match[1];
}

async function loadMaterials(only: string[] | null): Promise<Material[]> {
  const dir = new URL("materials/", root);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  const picked = only ? names.filter((name) => only.some((prefix) => name.startsWith(prefix))) : names;
  return Promise.all(
    picked.map(async (file) => ({ name: file.replace(/\.md$/, ""), text: (await readFile(new URL(file, dir), "utf8")).trim() })),
  );
}

function groqTransport(apiKey: string, model: string): Transport {
  return async (prompt) => {
    let res: Response;
    try {
      res = await fetch(GROQ_CHAT_URL, groqRequestInit({ apiKey, model }, prompt));
    } catch (error) {
      return { kind: "error", reason: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network" };
    }
    const rate = readRateInfo(res.headers, Date.now());
    const body: unknown = await res.json().catch(() => null);
    return { kind: "response", status: res.status, body, rate };
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const runs = Number(option("runs") ?? 3);
  const count = Number(option("count") ?? 10);
  if (!Number.isInteger(runs) || runs < 1 || (count !== 5 && count !== 10)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const only = option("only")?.split(",") ?? null;
  const materials = await loadMaterials(only);
  if (materials.length === 0) {
    console.error("Tidak ada materi yang cocok di tools/ai-eval/materials.");
    process.exitCode = 1;
    return;
  }

  const model = await textModel();
  let transport: Transport;
  let clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
  let random = Math.random;
  if (dryRun) {
    const fake = fakeClock(Date.UTC(2026, 9, 26, 3, 0));
    transport = fakeTransport(materials, fake);
    clock = fake;
    random = seededRandom(6);
  } else {
    // Key hanya diteruskan ke header Authorization; tidak pernah dicetak atau ditulis ke hasil.
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("GROQ_API_KEY belum diatur di shell ini. PowerShell: $env:GROQ_API_KEY = \"<key>\"; atau pakai --dry-run.");
      process.exitCode = 1;
      return;
    }
    transport = groqTransport(apiKey, model);
  }

  console.log(`${dryRun ? "DRY RUN: " : ""}${materials.length} materi × ${runs} percobaan, ${count} soal, model ${model}, prompt ${AI_PROMPT_VERSION}`);
  const result = await runEval({ materials, runs, count, transport, sleep: clock.sleep, now: clock.now, log: (line) => console.log(line) });

  const date = new Date(clock.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  const meta = { date, model, promptVersion: AI_PROMPT_VERSION, dryRun, runs, count, waitedMs: result.waitedMs, stoppedEarly: result.stoppedEarly };
  const summary = summarize(result.attempts, materials);
  const markdown = buildMarkdown(meta, summary, pickSamples(result.attempts, 5, random));

  const outDir = new URL("results/", root);
  await mkdir(outDir, { recursive: true });
  const base = `${date}-${AI_PROMPT_VERSION}${dryRun ? "-dry-run" : ""}`;
  await writeFile(new URL(`${base}.json`, outDir), JSON.stringify({ meta, summary, attempts: result.attempts }, null, 2) + "\n");
  await writeFile(new URL(`${base}.md`, outDir), markdown + "\n");

  console.log("");
  console.log(`Lolos skema: ${summary.passed}/${summary.completed}; grounded: ${summary.grounded}/${summary.questions}`);
  console.log(`Hasil: tools/ai-eval/results/${base}.md dan .json`);
  if (result.stoppedEarly) console.log(result.stoppedEarly);
}

await main();
