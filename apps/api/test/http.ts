import { env } from "cloudflare:workers";
import { app } from "../src/app.ts";

/** Sama dengan APP_ORIGIN di vitest.config.ts. */
export const ORIGIN = "https://sorak.test";

export function request(path: string, init?: RequestInit) {
  return app.request(`${ORIGIN}${path}`, init, env);
}

/** Nilai cookie dari header Set-Cookie, beserta atributnya. */
export function setCookie(res: Response, name: string): { value: string; attributes: string } | null {
  const header = res.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  if (!header) return null;
  const [pair = "", ...attributes] = header.split("; ");
  return { value: pair.slice(name.length + 1), attributes: attributes.join("; ") };
}

export async function insertHost(host: { id: string; email: string; sessionVersion?: number; subject?: string }) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO hosts (id, email, display_name, auth_provider, provider_subject, session_version, created_at, updated_at)
     VALUES (?, ?, 'Guru Test', 'google', ?, ?, ?, ?)`,
  )
    .bind(host.id, host.email, host.subject ?? `sub-${host.id}`, host.sessionVersion ?? 0, now, now)
    .run();
}
