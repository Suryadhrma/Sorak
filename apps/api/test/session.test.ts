import { env } from "cloudflare:workers";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { ORIGIN, insertHost, request, setCookie } from "./http.ts";

const inAWeek = () => Math.floor(Date.now() / 1000) + 604_800;

function me(token: string) {
  return request("/api/me", { headers: { Cookie: `sorak_session=${token}` } });
}

describe("sesi host", () => {
  it("tanpa cookie: 401 UNAUTHENTICATED", async () => {
    const res = await request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("cookie sesi yang bukan JWT: 401, bukan 500", async () => {
    expect((await me("bukan-jwt")).status).toBe(401);
  });

  it("JWT dengan tanda tangan salah: 401", async () => {
    const id = crypto.randomUUID();
    await insertHost({ id, email: "ttd@example.com" });
    const token = await sign({ sub: id, sv: 0, exp: inAWeek() }, "rahasia-orang-lain-yang-panjangnya-32", "HS256");
    expect((await me(token)).status).toBe(401);
  });

  it("session_version tidak cocok: 401", async () => {
    const id = crypto.randomUUID();
    await insertHost({ id, email: "sv@example.com", sessionVersion: 1 });
    const token = await sign({ sub: id, sv: 0, exp: inAWeek() }, env.JWT_SECRET, "HS256");
    expect((await me(token)).status).toBe(401);
  });

  it("JWT kedaluwarsa: 401", async () => {
    const id = crypto.randomUUID();
    await insertHost({ id, email: "exp@example.com" });
    const token = await sign({ sub: id, sv: 0, exp: Math.floor(Date.now() / 1000) - 1 }, env.JWT_SECRET, "HS256");
    expect((await me(token)).status).toBe(401);
  });

  it("host yang sudah tidak ada: 401", async () => {
    const token = await sign({ sub: crypto.randomUUID(), sv: 0, exp: inAWeek() }, env.JWT_SECRET, "HS256");
    expect((await me(token)).status).toBe(401);
  });

  it("sesi valid: 200 dengan data Host", async () => {
    const id = crypto.randomUUID();
    await insertHost({ id, email: "valid@example.com" });
    const token = await sign({ sub: id, sv: 0, exp: inAWeek() }, env.JWT_SECRET, "HS256");

    const res = await me(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, email: "valid@example.com", displayName: "Guru Test" });
  });

  it("logout menghapus cookie sesi dan menjawab 204", async () => {
    const res = await request("/api/auth/logout", { method: "POST", headers: { Origin: ORIGIN } });

    expect(res.status).toBe(204);
    const cookie = setCookie(res, "sorak_session");
    expect(cookie?.value).toBe("");
    expect(cookie?.attributes).toContain("Max-Age=0");
    expect(cookie?.attributes).toContain("Path=/");
  });

  it("csrf: POST tanpa body dari origin lain ditolak", async () => {
    const res = await request("/api/auth/logout", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});
