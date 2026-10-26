import { z } from "zod";
import { log } from "../log.ts";

const AiConfig = z.object({
  GROQ_API_KEY: z.string().min(1),
  GROQ_TEXT_MODEL: z.string().min(1),
});
export type AiConfig = z.infer<typeof AiConfig>;

/**
 * Null kalau key atau model belum diatur: fitur AI mati, editor manual tetap jalan. Env dibaca sebagai unknown
 * karena GROQ_API_KEY secret opsional, dan tipe Env hasil `wrangler types` tidak bisa menyatakan "mungkin tidak ada".
 */
export function readAiConfig(env: unknown): AiConfig | null {
  const config = AiConfig.safeParse(env);
  if (config.success) return config.data;
  const keys = [...new Set(config.error.issues.map((issue) => issue.path.join(".")))];
  log.info("ai_config_missing", { keys });
  return null;
}
