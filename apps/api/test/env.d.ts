declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    TEST_SEED: import("cloudflare:test").D1Migration[];
    TEST_PIN_LOOKUP_RATELIMIT: unknown;
    GOOGLE_CLIENT_ID: string;
    JWT_SECRET: string;
  }
}
