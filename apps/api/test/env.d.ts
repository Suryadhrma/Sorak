declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    TEST_SEED: import("cloudflare:test").D1Migration[];
    TEST_PIN_LOOKUP_RATELIMIT: unknown;
    TEST_WS_CONNECT_RATELIMIT: unknown;
    TEST_GAME_EVENTS_CONSUMER: unknown;
    GOOGLE_CLIENT_ID: string;
    JWT_SECRET: string;
    // Secret opsional, jadi tidak ikut `wrangler types` kalau belum ada di .dev.vars; nilai test di vitest.config.ts.
    GROQ_API_KEY: string;
  }
}
