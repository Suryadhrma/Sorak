import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { OAUTH_STATE_TTL_SEC } from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { readAuthConfig, type AuthConfig } from "./auth-config.ts";
import { exchangeCodeForIdToken, googleAuthorizationUrl, parseGoogleIdToken, randomToken } from "./google.ts";
import { isEmailTakenByOtherHost, upsertGoogleHost } from "./hosts.ts";
import { log } from "./log.ts";
import { clearSessionCookie, issueSessionCookie } from "./session.ts";

export const authRoutes = new Hono<{ Bindings: Env }>();

const OAUTH_COOKIE = "sorak_oauth";
const OAUTH_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "Lax", path: "/api/auth" } as const;

// state dan code_verifier disimpan dalam satu cookie, dipisah titik (base64url tidak memakai titik).
const OAuthCookie = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
  .transform((value) => {
    const dot = value.indexOf(".");
    return { state: value.slice(0, dot), codeVerifier: value.slice(dot + 1) };
  });

const CallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });

type AppContext = Context<{ Bindings: Env }>;
type LoginOutcome = "/quizzes" | "/login?error=email_taken" | "/login?error=google_failed";

authRoutes.get("/google/start", async (c) => {
  const config = readAuthConfig(c.env);
  if (!config) return apiError(c, 500, "INTERNAL", "Konfigurasi login di server belum lengkap");

  const state = randomToken();
  const codeVerifier = randomToken();
  setCookie(c, OAUTH_COOKIE, `${state}.${codeVerifier}`, { ...OAUTH_COOKIE_OPTIONS, maxAge: OAUTH_STATE_TTL_SEC });
  return c.redirect(await googleAuthorizationUrl(config, state, codeVerifier), 302);
});

authRoutes.get("/google/callback", async (c) => {
  const config = readAuthConfig(c.env);
  if (!config) return apiError(c, 500, "INTERNAL", "Konfigurasi login di server belum lengkap");

  const stored = OAuthCookie.safeParse(getCookie(c, OAUTH_COOKIE));
  // Sekali pakai: state lama tidak boleh dipakai ulang, berhasil atau gagal.
  deleteCookie(c, OAUTH_COOKIE, OAUTH_COOKIE_OPTIONS);
  if (!stored.success) return loginFailed(c, "oauth_cookie_missing");

  const query = CallbackQuery.safeParse(c.req.query());
  if (!query.success) return loginFailed(c, "callback_query_invalid");
  if (query.data.state !== stored.data.state) return loginFailed(c, "state_mismatch");

  // Yang membuka rute ini adalah browser, jadi kegagalan tak terduga juga dijawab redirect, bukan JSON.
  try {
    const outcome = await completeGoogleLogin(c, config, query.data.code, stored.data.codeVerifier);
    return c.redirect(outcome, 302);
  } catch (error) {
    return loginFailed(c, "unexpected_error", error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/logout", (c) => {
  // Token yang sudah dicuri tetap berlaku sampai exp; menaikkan session_version belum dibuat (di luar Hari 1).
  clearSessionCookie(c);
  return c.body(null, 204);
});

async function completeGoogleLogin(
  c: AppContext,
  config: AuthConfig,
  code: string,
  codeVerifier: string,
): Promise<LoginOutcome> {
  const idToken = await exchangeCodeForIdToken(config, code, codeVerifier);
  if (!idToken) return "/login?error=google_failed";

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const profile = parseGoogleIdToken(idToken, config.GOOGLE_CLIENT_ID, nowSec);
  if (!profile) return "/login?error=google_failed";

  if (await isEmailTakenByOtherHost(c.env.DB, profile)) {
    log.info("google_login_email_taken", {});
    return "/login?error=email_taken";
  }

  const host = await upsertGoogleHost(c.env.DB, profile, nowMs);
  await issueSessionCookie(c, host, config.JWT_SECRET, nowSec);
  log.info("host_logged_in", { hostId: host.id });
  return "/quizzes";
}

function loginFailed(c: AppContext, reason: string, detail?: string) {
  log.error("google_login_failed", { reason, detail });
  return c.redirect("/login?error=google_failed", 302);
}
