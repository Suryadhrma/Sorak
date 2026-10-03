import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import {
  JwtAlgorithmMismatch,
  JwtHeaderInvalid,
  JwtTokenExpired,
  JwtTokenInvalid,
  JwtTokenIssuedAt,
  JwtTokenNotBefore,
  JwtTokenSignatureMismatched,
} from "hono/utils/jwt/types";
import { z } from "zod";
import { SESSION_TTL_SEC, type Host } from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { readAuthConfig } from "./auth-config.ts";
import { findHostById, type HostRecord } from "./hosts.ts";
import { log } from "./log.ts";

const SESSION_COOKIE = "sorak_session";

/** `sv` dicocokkan dengan hosts.session_version; menaikkan kolom itu membatalkan semua sesi lama. */
const SessionClaims = z.object({
  sub: z.uuid(),
  sv: z.number().int().min(0),
  exp: z.number(),
});

export async function issueSessionCookie(c: Context, host: HostRecord, jwtSecret: string, nowSec: number): Promise<void> {
  const token = await sign({ sub: host.id, sv: host.sessionVersion, exp: nowSec + SESSION_TTL_SEC }, jwtSecret, "HS256");
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
}

// Error dari verify yang artinya "token tidak sah", bukan kerusakan server.
const TOKEN_REJECTIONS = [
  JwtTokenInvalid,
  JwtTokenExpired,
  JwtTokenNotBefore,
  JwtTokenIssuedAt,
  JwtTokenSignatureMismatched,
  JwtAlgorithmMismatch,
  JwtHeaderInvalid,
];

async function verifiedClaims(token: string, jwtSecret: string) {
  try {
    // Algoritma ditulis eksplisit supaya token dengan header "alg" lain (misalnya "none") ditolak.
    return SessionClaims.safeParse(await verify(token, jwtSecret, "HS256"));
  } catch (error) {
    if (TOKEN_REJECTIONS.some((rejection) => error instanceof rejection)) return null;
    throw error;
  }
}

export const requireHost = createMiddleware<{ Bindings: Env; Variables: { host: Host } }>(async (c, next) => {
  const config = readAuthConfig(c.env);
  if (!config) return apiError(c, 500, "INTERNAL", "Konfigurasi login di server belum lengkap");

  const unauthenticated = () => apiError(c, 401, "UNAUTHENTICATED", "Silakan masuk dulu");
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return unauthenticated();

  const claims = await verifiedClaims(token, config.JWT_SECRET);
  if (!claims?.success) return unauthenticated();

  const host = await findHostById(c.env.DB, claims.data.sub);
  if (!host || host.sessionVersion !== claims.data.sv) {
    log.info("session_rejected", { reason: host ? "session_version" : "host_missing" });
    return unauthenticated();
  }

  c.set("host", { id: host.id, email: host.email, displayName: host.displayName });
  await next();
});
