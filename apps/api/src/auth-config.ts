import { z } from "zod";
import { log } from "./log.ts";

const AuthConfig = z.object({
  APP_ORIGIN: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(32),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

/** Null kalau ada kunci yang hilang atau salah; nama kuncinya dicatat di log, nilainya tidak. */
export function readAuthConfig(env: unknown): AuthConfig | null {
  const config = AuthConfig.safeParse(env);
  if (config.success) return config.data;
  const keys = [...new Set(config.error.issues.map((issue) => issue.path.join(".")))];
  log.error("auth_config_invalid", { keys });
  return null;
}
