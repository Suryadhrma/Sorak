import { env } from "cloudflare:workers";
import { sign } from "hono/jwt";
import { encodeBase64Url } from "hono/utils/encode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.ts";
import { ORIGIN, insertHost, request, setCookie } from "./http.ts";

type GoogleClaims = {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
};

const claims = (extra: Partial<GoogleClaims> = {}): GoogleClaims => ({
  iss: "https://accounts.google.com",
  aud: env.GOOGLE_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "google-sub-1",
  email: "guru@example.com",
  email_verified: true,
  name: "Bu Guru",
  ...extra,
});

/** Endpoint token Google di-mock lewat globalThis.fetch (anjuran pool-workers >= 0.13). */
async function mockGoogleToken(idTokenClaims: GoogleClaims) {
  // Tanda tangan id_token tidak diperiksa server, jadi kunci apa pun cukup.
  const idToken = await sign(idTokenClaims, "kunci-test-bukan-milik-google", "HS256");
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ access_token: "ya29.test", expires_in: 3599, token_type: "Bearer", id_token: idToken }));
}

async function startLogin() {
  const res = await request("/api/auth/google/start");
  const cookie = setCookie(res, "sorak_oauth");
  const location = new URL(res.headers.get("Location") ?? "");
  return { res, cookie, location, state: location.searchParams.get("state") ?? "" };
}

function callback(state: string, oauthCookie: string | undefined) {
  const headers = oauthCookie ? { Cookie: `sorak_oauth=${oauthCookie}` } : undefined;
  return request(`/api/auth/google/callback?code=kode-dari-google&state=${state}`, { headers });
}

async function hostsWithSubject(sub: string) {
  const { results } = await env.DB.prepare("SELECT email FROM hosts WHERE provider_subject = ?")
    .bind(sub)
    .all<{ email: string }>();
  return results;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/auth/google/start", () => {
  it("redirect ke Google dengan parameter OAuth + PKCE dan menyetel cookie sorak_oauth", async () => {
    const { res, cookie, location } = await startLogin();

    expect(res.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const params = location.searchParams;
    expect(params.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid email profile");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("prompt")).toBe("select_account");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(cookie?.attributes).toContain("HttpOnly");
    expect(cookie?.attributes).toContain("Secure");
    expect(cookie?.attributes).toContain("SameSite=Lax");
    expect(cookie?.attributes).toContain("Path=/api/auth");
    expect(cookie?.attributes).toContain("Max-Age=600");

    // code_challenge = base64url tanpa padding dari SHA-256(code_verifier), sesuai RFC 7636.
    const verifier = cookie?.value.split(".")[1] ?? "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(params.get("code_challenge")).toBe(encodeBase64Url(digest).replace(/=+$/, ""));
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("konfigurasi auth tidak lengkap", () => {
  it("menjawab 500 INTERNAL dan mencatat nama kunci yang hilang, bukan nilainya", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await app.request(`${ORIGIN}/api/auth/google/start`, undefined, { ...env, GOOGLE_CLIENT_SECRET: "" });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "INTERNAL" } });
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ event: "auth_config_invalid", keys: ["GOOGLE_CLIENT_SECRET"] }));
  });
});

describe("GET /api/auth/google/callback", () => {
  it("menolak state yang tidak cocok tanpa menghubungi Google, dan selalu menghapus cookie sorak_oauth", async () => {
    const fetchSpy = await mockGoogleToken(claims());
    const { cookie } = await startLogin();

    const res = await callback("state-palsu", cookie?.value);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=google_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setCookie(res, "sorak_oauth")?.attributes).toContain("Max-Age=0");
  });

  it("menolak kalau cookie sorak_oauth tidak ada", async () => {
    const { state } = await startLogin();
    const res = await callback(state, undefined);
    expect(res.headers.get("Location")).toBe("/login?error=google_failed");
  });

  it.each([
    ["aud milik aplikasi lain", { sub: "sub-aud", aud: "aplikasi-lain.apps.googleusercontent.com" }],
    ["email_verified false", { sub: "sub-unverified", email_verified: false }],
    ["iss bukan Google", { sub: "sub-iss", iss: "https://evil.example" }],
    ["exp sudah lewat", { sub: "sub-exp", exp: Math.floor(Date.now() / 1000) - 10 }],
  ])("menolak id_token dengan %s", async (_label, extra) => {
    await mockGoogleToken(claims(extra));
    const { cookie, state } = await startLogin();

    const res = await callback(state, cookie?.value);

    expect(res.headers.get("Location")).toBe("/login?error=google_failed");
    expect(await hostsWithSubject(extra.sub)).toEqual([]);
  });

  it("menukar code dengan code_verifier dan client_secret, membuat host baru, lalu menyetel cookie sesi", async () => {
    const fetchSpy = await mockGoogleToken(claims({ sub: "sub-baru", email: "baru@example.com" }));
    const { cookie, state } = await startLogin();

    const res = await callback(state, cookie?.value);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/quizzes");
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("code")).toBe("kode-dari-google");
    expect(body.get("code_verifier")).toBe(cookie?.value.split(".")[1]);
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(body.get("grant_type")).toBe("authorization_code");

    const session = setCookie(res, "sorak_session");
    expect(session?.attributes).toContain("HttpOnly");
    expect(session?.attributes).toContain("Secure");
    expect(session?.attributes).toContain("SameSite=Lax");
    expect(session?.attributes).toContain("Path=/");
    expect(session?.attributes).toContain("Max-Age=604800");
    expect(await hostsWithSubject("sub-baru")).toEqual([{ email: "baru@example.com" }]);

    const me = await request("/api/me", { headers: { Cookie: `sorak_session=${session?.value}` } });
    expect(await me.json()).toMatchObject({ email: "baru@example.com", displayName: "Bu Guru" });
  });

  it("login kedua tidak membuat host ganda, dan email yang berubah di Google ikut diperbarui", async () => {
    await mockGoogleToken(claims({ sub: "sub-dua-kali", email: "lama@example.com" }));
    const first = await startLogin();
    await callback(first.state, first.cookie?.value);

    vi.restoreAllMocks();
    await mockGoogleToken(claims({ sub: "sub-dua-kali", email: "baru-lagi@example.com" }));
    const second = await startLogin();
    const res = await callback(second.state, second.cookie?.value);

    expect(res.headers.get("Location")).toBe("/quizzes");
    expect(await hostsWithSubject("sub-dua-kali")).toEqual([{ email: "baru-lagi@example.com" }]);
  });

  it("menolak email yang sudah dipakai host lain, tanpa membedakan huruf besar-kecil", async () => {
    await insertHost({ id: crypto.randomUUID(), email: "dipakai@example.com", subject: "sub-pemilik-email" });
    await mockGoogleToken(claims({ sub: "sub-penumpang", email: "Dipakai@Example.com" }));
    const { cookie, state } = await startLogin();

    const res = await callback(state, cookie?.value);

    expect(res.headers.get("Location")).toBe("/login?error=email_taken");
    expect(await hostsWithSubject("sub-penumpang")).toEqual([]);
  });

  it("memotong nama Google yang lebih panjang dari batas display_name", async () => {
    await mockGoogleToken(claims({ sub: "sub-nama-panjang", email: "panjang@example.com", name: "N".repeat(80) }));
    const { cookie, state } = await startLogin();
    await callback(state, cookie?.value);

    const row = await env.DB.prepare("SELECT display_name FROM hosts WHERE provider_subject = ?")
      .bind("sub-nama-panjang")
      .first<{ display_name: string }>();
    expect(row?.display_name).toHaveLength(60);
  });
});
