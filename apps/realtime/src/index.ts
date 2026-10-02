export { GameRoom } from "./game-room.ts";

export default {
  // GameRoom hanya dicapai lewat binding Durable Object dari Worker "sorak", bukan dari internet.
  fetch: () => new Response(null, { status: 404 }),
} satisfies ExportedHandler<Env>;
