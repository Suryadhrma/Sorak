import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { apiError } from "./api-error.ts";
import { authRoutes } from "./auth.ts";
import { log } from "./log.ts";
import { quizRoutes } from "./quiz-routes.ts";
import { roomRoutes, wsRoutes } from "./room-routes.ts";
import { requireHost } from "./session.ts";

// Pesan Zod sampai ke guru lewat `fields` di editor, jadi pakai Bahasa Indonesia.
z.config(z.locales.id());

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

app.route("/api/quizzes", quizRoutes);

app.route("/api/rooms", roomRoutes);

app.route("/ws", wsRoutes);
