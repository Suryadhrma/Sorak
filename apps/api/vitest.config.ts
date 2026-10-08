import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { unstable_readConfig } from "wrangler";
import { defineConfig } from "vitest/config";

// FAKE, bukan kode produksi. Binding GAME_ROOM di wrangler.jsonc menunjuk Worker "sorak-realtime" yang tidak ada
// di lingkungan test. Yang diuji di sini logika Worker api (percobaan PIN ulang, pemetaan status, header);
// GameRoom asli diuji di apps/realtime, dan sambungan keduanya lewat pnpm dev.
// - POST /init: PIN yang sudah pernah di-init menjawab pin_in_use.
// - GET /join-info: status yang diatur test lewat PUT /fake/join-info, atau open/not_found dari init.
// - GET /connect: membalas URL dan header yang diterima, supaya test bisa memeriksa apa yang diteruskan Worker.
// - GET /fake/init: input init terakhir, untuk memeriksa snapshot kuis.
const gameRoomFake = `
import { DurableObject } from "cloudflare:workers";
export class GameRoomFake extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const route = request.method + " " + url.pathname;
    if (route === "POST /init") {
      if (await this.ctx.storage.get("init")) return Response.json({ ok: false, reason: "pin_in_use" });
      await this.ctx.storage.put("init", await request.json());
      return Response.json({ ok: true });
    }
    if (route === "GET /join-info") {
      const configured = await this.ctx.storage.get("joinInfo");
      if (configured) return Response.json(configured);
      const init = await this.ctx.storage.get("init");
      return Response.json({ status: init ? "open" : "not_found", playerCount: 0 });
    }
    if (route === "PUT /fake/join-info") {
      await this.ctx.storage.put("joinInfo", await request.json());
      return new Response(null, { status: 204 });
    }
    if (route === "GET /fake/init") return Response.json((await this.ctx.storage.get("init")) ?? null);
    if (route === "GET /connect") return Response.json({ url: request.url, headers: Object.fromEntries(request.headers) });
    return new Response(null, { status: 404 });
  }
}
export { GameRoomFake as GameRoom };
export default {};
`;

export default defineConfig(async () => {
  // Dibaca di Node (akses file), lalu diteruskan ke Worker test sebagai binding.
  const migrations = await readD1Migrations("migrations");
  // Pemecah query yang sama dengan migrasi, supaya test menjalankan seed persis per pernyataan.
  const seed = await readD1Migrations("seed");
  // Test membandingkan binding yang benar-benar dipakai dengan PIN_LOOKUP_LIMIT di @sorak/shared.
  const pinLookup = unstable_readConfig({ config: "./wrangler.jsonc" }).ratelimits.find((limit) => limit.name === "PIN_LOOKUP");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_SEED: seed,
            TEST_PIN_LOOKUP_RATELIMIT: pinLookup ?? null,
            // Nilai khusus test; Google di-mock lewat globalThis.fetch.
            APP_ORIGIN: "https://sorak.test",
            GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            JWT_SECRET: "test-jwt-secret-0123456789abcdefghijklmnop",
          },
          workers: [
            {
              name: "sorak-realtime",
              modules: true,
              script: gameRoomFake,
              compatibilityDate: "2026-08-22",
              durableObjects: { GAME_ROOM: "GameRoom" },
            },
          ],
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
