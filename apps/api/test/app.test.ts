import { describe, expect, it } from "vitest";
import { app } from "../src/app.ts";

describe("app", () => {
  it("GET /api/health menjawab 200", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it.each(["/ws/play/abc", "/ws/host/12345", "/ws/play/1234567"])("menolak PIN tidak valid: %s", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "BAD_MESSAGE" } });
  });

  it("rute selain play dan host tidak ada", async () => {
    const res = await app.request("/ws/admin/123456");
    expect(res.status).toBe(404);
  });
});
