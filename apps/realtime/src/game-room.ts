import { DurableObject } from "cloudflare:workers";
import { HEARTBEAT } from "@sorak/shared";

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat dijawab runtime langsung, jadi objek yang sedang hibernasi tidak dibangunkan.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT.request, HEARTBEAT.response));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(null, { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
}
