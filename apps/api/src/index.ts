import { app } from "./app.ts";
import { consumeGameEvents } from "./game-events.ts";
import { deleteExpiredGames } from "./retention.ts";

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    await consumeGameEvents(batch.messages, env.DB, Date.now());
  },
  async scheduled(controller, env) {
    await deleteExpiredGames(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
