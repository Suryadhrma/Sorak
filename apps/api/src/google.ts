import { decode } from "hono/jwt";
import { encodeBase64Url } from "hono/utils/encode";
import { z } from "zod";
import type { AuthConfig } from "./auth-config.ts";
import { log } from "./log.ts";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GoogleProfile = { sub: string; email: string; name: string };

// RFC 7636 mewajibkan base64url tanpa padding "=", sedangkan encodeBase64Url milik Hono tetap memakainya.
function base64UrlNoPadding(bytes: ArrayBuffer): string {
  return encodeBase64Url(bytes).replace(/=+$/, "");
}

/** 32 byte acak dalam base64url (43 karakter); dipakai untuk `state` dan `code_verifier`. */
export function randomToken(): string {
  return base64UrlNoPadding(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export function callbackUrl(config: AuthConfig): string {
  return `${config.APP_ORIGIN}/api/auth/google/callback`;
}

export async function googleAuthorizationUrl(config: AuthConfig, state: string, codeVerifier: string): Promise<string> {
  // PKCE S256: Google hanya menerima code ini dari pihak yang memegang verifier aslinya.
  const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(config),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: base64UrlNoPadding(challenge),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTHORIZATION_ENDPOINT}?${params}`;
}

const TokenResponse = z.object({ id_token: z.string().min(1) });

/** Null kalau Google menolak code atau responsnya tidak sesuai skema. */
export async function exchangeCodeForIdToken(config: AuthConfig, code: string, codeVerifier: string): Promise<string | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(config),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    log.error("google_token_rejected", { status: res.status });
    return null;
  }
  const token = TokenResponse.safeParse(await res.json());
  if (!token.success) {
    log.error("google_token_invalid_shape", { issues: token.error.issues });
    return null;
  }
  return token.data.id_token;
}

const IdTokenClaims = z.object({
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  aud: z.string(),
  exp: z.number(),
  email_verified: z.literal(true),
  sub: z.string().min(1),
  email: z.email(),
  name: z.string().trim().min(1),
});

export function parseGoogleIdToken(idToken: string, clientId: string, nowSec: number): GoogleProfile | null {
  // Tanda tangan sengaja tidak diverifikasi: token ini diterima langsung dari endpoint token
  // Google lewat TLS, bukan dari browser (OpenID Connect Core 1.0, 3.1.3.7 butir 6).
  let payload: unknown;
  try {
    payload = decode(idToken).payload;
  } catch (error) {
    log.error("google_id_token_malformed", { message: error instanceof Error ? error.message : String(error) });
    return null;
  }
  const claims = IdTokenClaims.safeParse(payload);
  if (!claims.success) {
    log.error("google_id_token_claims_invalid", { paths: claims.error.issues.map((issue) => issue.path.join(".")) });
    return null;
  }
  if (claims.data.aud !== clientId) {
    log.error("google_id_token_wrong_audience", {});
    return null;
  }
  if (claims.data.exp <= nowSec) {
    log.error("google_id_token_expired", {});
    return null;
  }
  return { sub: claims.data.sub, email: claims.data.email, name: claims.data.name };
}
