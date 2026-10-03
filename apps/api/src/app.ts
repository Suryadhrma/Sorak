import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { ErrorCode, Pin } from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { authRoutes } from "./auth.ts";
import { log } from "./log.ts";
import { requireHost } from "./session.ts";

export const app = new Hono<{ Bindings: Env }>();

// Lapisan kedua di atas SameSite=Lax: POST bergaya form dari situs lain ditolak.
app.use("/api/*", csrf({ origin: (origin, c) => origin === c.env.APP_ORIGIN }));

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  log.error("unhandled_error", { path: c.req.path, message: error.message });
  return apiError(c, 500, "INTERNAL", "Terjadi kesalahan di server");
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", authRoutes);

app.get("/api/me", requireHost, (c) => c.json(c.var.host));

app.get("/ws/:role{play|host}/:pin", async (c) => {
  const pin = Pin.safeParse(c.req.param("pin"));
  if (!pin.success) {
    const message = pin.error.issues.map((issue) => issue.message).join("; ");
    return c.json({ error: { code: ErrorCode.enum.BAD_MESSAGE, message } }, 400);
  }
  // Satu PIN = satu GameRoom, jadi host dan semua pemain dengan PIN sama bertemu di objek yang sama.
  return c.env.GAME_ROOM.getByName(pin.data).fetch(c.req.raw);
});
