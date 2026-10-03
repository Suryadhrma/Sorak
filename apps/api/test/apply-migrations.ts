import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Test memakai skema D1 yang sama persis dengan produksi, dari apps/api/migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
