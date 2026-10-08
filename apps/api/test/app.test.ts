import { describe, expect, it } from "vitest";
import { app } from "../src/app.ts";
import { request } from "./http.ts";

describe("app", () => {
  it("GET /api/health menjawab 200", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it.each(["/ws/play/abc", "/ws/play/12345", "/ws/play/1234567"])("PIN tidak valid dijawab seperti room tidak ada: %s", async (path) => {
    const res = await request(path);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("rute selain play dan host tidak ada", async () => {
    const res = await app.request("/ws/admin/123456");
    expect(res.status).toBe(404);
  });
});
