import { app } from "./app.ts";
import { consumeGameEvents } from "./game-events.ts";

export default {
  fetch: app.fetch,
  queue(batch) {
    consumeGameEvents(batch.messages);
  },
} satisfies ExportedHandler<Env>;
