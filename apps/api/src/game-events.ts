import { GameEndedEvent } from "@sorak/shared";
import { log } from "./log.ts";

export function consumeGameEvents(messages: readonly Message<unknown>[]): void {
  for (const message of messages) {
    const event = GameEndedEvent.safeParse(message.body);
    if (!event.success) {
      // Di-ack karena retry tidak akan memperbaiki pesan yang bentuknya salah.
      log.error("game_ended_invalid", { messageId: message.id, issues: event.error.issues });
      message.ack();
      continue;
    }
    log.info("game_ended_received", {
      gameId: event.data.gameId,
      pin: event.data.pin,
      players: event.data.players.length,
    });
    message.ack();
  }
}
