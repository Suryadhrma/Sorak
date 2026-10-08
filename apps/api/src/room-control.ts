import {
  InitRoomResult,
  JoinInfo,
  ROOM_CONTROL_ORIGIN,
  RoomControlPath,
  RoomHeader,
  type InitRoomInput,
  type Pin,
  type RoomRoute,
} from "@sorak/shared";

/**
 * Pembungkus fetch internal ke GameRoom di Worker "sorak-realtime" (ADR 0004: fetch, bukan RPC).
 * GameRoom bisa versi lain sesaat setelah deploy, jadi jawabannya divalidasi di sini juga.
 */

/** Satu-satunya cara memilih GameRoom, supaya REST dan WebSocket selalu memakai nama objek yang sama. */
export function roomStub(env: Env, pin: Pin): DurableObjectStub {
  return env.GAME_ROOM.getByName(`room:${pin}`);
}

export async function initRoom(stub: DurableObjectStub, input: InitRoomInput): Promise<InitRoomResult> {
  const res = await stub.fetch(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.init}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`GameRoom menolak init: status ${res.status}`);
  return InitRoomResult.parse(await res.json());
}

export async function getJoinInfo(stub: DurableObjectStub): Promise<JoinInfo> {
  const res = await stub.fetch(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.joinInfo}`);
  if (!res.ok) throw new Error(`GameRoom menolak join-info: status ${res.status}`);
  return JoinInfo.parse(await res.json());
}

// Hanya header jabat tangan WebSocket yang disalin. Header lain dari klien, termasuk X-Sorak-Host-Id
// palsu, tidak pernah sampai ke GameRoom.
const UPGRADE_HEADERS = [
  "Upgrade",
  "Connection",
  "Sec-WebSocket-Key",
  "Sec-WebSocket-Version",
  "Sec-WebSocket-Protocol",
  "Sec-WebSocket-Extensions",
];

/**
 * Request baru ke URL internal tetap: URL dari klien tidak pernah diteruskan, jadi request dari internet
 * tidak bisa mencapai /init apa pun bentuk URL-nya.
 */
export function connectRequest(original: Request, route: RoomRoute, hostId: string | null): Request {
  const headers = new Headers();
  for (const name of UPGRADE_HEADERS) {
    const value = original.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set(RoomHeader.route, route);
  if (hostId !== null) headers.set(RoomHeader.hostId, hostId);
  return new Request(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.connect}`, { headers });
}
