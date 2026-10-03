import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("D1 test", () => {
  it("migrasi apps/api/migrations sudah diterapkan sebelum test", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(["0001_init.sql"]);
  });
});
