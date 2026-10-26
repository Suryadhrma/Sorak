export type GenerationStatus = "ok" | "invalid_schema" | "provider_error" | "quota_exceeded";

export type Generation = {
  hostId: string;
  model: string;
  status: GenerationStatus;
  questionsCount: number;
  groundedCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  promptVersion: string;
  createdAt: number;
};

/** Hanya metrik. Isi materi dan isi soal sengaja tidak disimpan (minimalisasi data). */
export async function recordGeneration(db: D1Database, generation: Generation): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_generations
         (id, host_id, input_type, model, status, questions_count, grounded_count, input_tokens, output_tokens, latency_ms,
          prompt_version, created_at)
       VALUES (?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      generation.hostId,
      generation.model,
      generation.status,
      generation.questionsCount,
      generation.groundedCount,
      generation.inputTokens,
      generation.outputTokens,
      generation.latencyMs,
      generation.promptVersion,
      generation.createdAt,
    )
    .run();
}
