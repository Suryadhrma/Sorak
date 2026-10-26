import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("D1 test", () => {
  it("migrasi apps/api/migrations sudah diterapkan sebelum test", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(["0001_init.sql", "0002_ai_generations_metrics.sql"]);
  });

  it("0002: ai_generations punya grounded_count (tidak boleh negatif) dan prompt_version", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('ai_generations')").all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(expect.arrayContaining(["grounded_count", "prompt_version"]));
    await env.DB.prepare(`INSERT INTO hosts (id, email, display_name, auth_provider, provider_subject, created_at, updated_at)
       VALUES ('h-d1', 'd1@example.com', 'D1', 'google', 'sub-d1', 0, 0)`).run();
    const insert = (grounded: number | null) =>
      env.DB.prepare(
        `INSERT INTO ai_generations (id, host_id, input_type, model, status, grounded_count, prompt_version, created_at)
         VALUES (?, 'h-d1', 'text', 'm', 'ok', ?, 'gen-text-v1', 0)`,
      )
        .bind(crypto.randomUUID(), grounded)
        .run();
    await expect(insert(3)).resolves.toBeDefined();
    await expect(insert(null)).resolves.toBeDefined();
    await expect(insert(-1)).rejects.toThrow();
  });
});
