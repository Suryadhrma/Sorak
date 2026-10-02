import { Hono } from "hono";
import { ErrorCode, Pin } from "@sorak/shared";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/ws/:role{play|host}/:pin", async (c) => {
  const pin = Pin.safeParse(c.req.param("pin"));
  if (!pin.success) {
    const message = pin.error.issues.map((issue) => issue.message).join("; ");
    return c.json({ error: { code: ErrorCode.enum.BAD_MESSAGE, message } }, 400);
  }
  // Satu PIN = satu GameRoom, jadi host dan semua pemain dengan PIN sama bertemu di objek yang sama.
  return c.env.GAME_ROOM.getByName(pin.data).fetch(c.req.raw);
});
