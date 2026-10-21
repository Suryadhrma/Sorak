import { Hono, type Context } from "hono";
import { z } from "zod";
import { GameId, type Host } from "@sorak/shared";
import { apiError } from "./api-error.ts";
import { decodeGameCursor, findGame, listGames } from "./game-history.ts";
import { requireHost } from "./session.ts";

type GameEnv = { Bindings: Env; Variables: { host: Host } };

export const gameRoutes = new Hono<GameEnv>();

gameRoutes.use("*", requireHost);

// Game milik host lain dijawab sama dengan game yang tidak ada, supaya id yang valid tidak bisa ditebak.
const gameNotFound = (c: Context) => apiError(c, 404, "NOT_FOUND", "Game tidak ditemukan");

const ListQuery = z.object({ cursor: z.string().min(1).optional() });

gameRoutes.get("/", async (c) => {
  const query = ListQuery.safeParse(c.req.query());
  if (!query.success) return apiError(c, 400, "VALIDATION_FAILED", "Parameter halaman tidak valid");
  const raw = query.data.cursor;
  const cursor = raw === undefined ? null : decodeGameCursor(raw);
  if (raw !== undefined && cursor === null) return apiError(c, 400, "VALIDATION_FAILED", "Cursor halaman tidak valid");
  return c.json(await listGames(c.env.DB, c.var.host.id, cursor));
});

gameRoutes.get("/:id", async (c) => {
  const gameId = GameId.safeParse(c.req.param("id"));
  if (!gameId.success) return gameNotFound(c);
  const game = await findGame(c.env.DB, c.var.host.id, gameId.data);
  return game ? c.json(game) : gameNotFound(c);
});
