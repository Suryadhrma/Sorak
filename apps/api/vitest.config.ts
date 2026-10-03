import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// TEST DOUBLE, bukan kode produksi. Binding GAME_ROOM di wrangler.jsonc menunjuk Worker
// "sorak-realtime" yang tidak ada di lingkungan test. Test api tidak menguji GameRoom
// (penerusan WebSocket dibuktikan lewat wrangler dev), jadi pengganti ini selalu menjawab 501.
const realtimeTestDouble = `
import { DurableObject } from "cloudflare:workers";
export class GameRoomTestDouble extends DurableObject {
  fetch() { return new Response("GameRoom test double", { status: 501 }); }
}
export { GameRoomTestDouble as GameRoom };
export default {};
`;

export default defineConfig(async () => {
  // Dibaca di Node (akses file), lalu diteruskan ke Worker test sebagai binding.
  const migrations = await readD1Migrations("migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
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
              script: realtimeTestDouble,
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
