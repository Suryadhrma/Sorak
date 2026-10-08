import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  HEARTBEAT,
  InitRoomInput,
  LOBBY_IDLE_TIMEOUT_MS,
  MAX_CONSECUTIVE_INVALID_MESSAGES,
  MAX_PLAYERS_PER_ROOM,
  PROTOCOL_VERSION,
  QuizSnapshot,
  RoomControlPath,
  RoomHeader,
  RoomRoute,
  RoomState,
  SocketAttachment,
  StorageKey,
  decodeHostMessage,
  decodePlayerMessage,
  encodeServerMessage,
  isAllowedInPhase,
  nicknameKey,
  type DecodeResult,
  type ErrorCode,
  type HostMessage,
  type InitRoomResult,
  type JoinInfo,
  type PlayerAttachment,
  type PlayerMessage,
  type RoomInfo,
  type RosterEntry,
  type ServerMessage,
} from "@sorak/shared";
import { log } from "./log.ts";
import { takeToken, type TokenBucket } from "./rate-limit.ts";
import { hashSessionToken, newSessionToken } from "./session-token.ts";
import { isStale } from "./stale.ts";

type DecodeFailure = Extract<DecodeResult<unknown>, { ok: false }>;
type PlayerSocket = [WebSocket, PlayerAttachment];

export class GameRoom extends DurableObject<Env> {
  private state: RoomState | null = null;
  private quiz: QuizSnapshot | null = null;
  /**
   * Roster hidup: satu-satunya sumber kebenaran siapa yang tersambung, dibangun ulang dari attachment
   * setiap bangun dari hibernasi. Socket yang ditutup server langsung dikeluarkan dari sini, karena
   * HP yang hilang sinyal tidak pernah membalas close dan getWebSockets() masih bisa mengembalikannya.
   */
  private readonly sockets = new Map<WebSocket, SocketAttachment>();
  // Batas pesan per socket cukup di memori: setelah hibernasi ember kembali penuh, tidak merugikan siapa pun.
  private readonly buckets = new WeakMap<WebSocket, TokenBucket>();
  private readonly invalidStreaks = new WeakMap<WebSocket, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat dijawab runtime langsung, jadi objek yang sedang hibernasi tidak dibangunkan.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT.request, HEARTBEAT.response));
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    const stored = await this.ctx.storage.get([StorageKey.state, StorageKey.quiz]);
    const state = stored.get(StorageKey.state);
    const quiz = stored.get(StorageKey.quiz);
    this.state = state === undefined ? null : RoomState.parse(state);
    this.quiz = quiz === undefined ? null : QuizSnapshot.parse(quiz);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const attachment = SocketAttachment.safeParse(ws.deserializeAttachment());
      if (!attachment.success) {
        log.error("attachment_invalid", { detail: attachment.error.message });
        ws.close(CloseCode.INTERNAL_ERROR, "Data koneksi rusak");
        continue;
      }
      this.sockets.set(ws, attachment.data);
    }
  }

  // Allowlist: hanya tiga jalur kontrol dari Worker "sorak"; selain itu tidak ada.
  override async fetch(request: Request): Promise<Response> {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    if (route === `POST ${RoomControlPath.init}`) return this.init(request);
    if (route === `GET ${RoomControlPath.joinInfo}`) return this.joinInfo();
    if (route === `GET ${RoomControlPath.connect}`) return this.acceptConnection(request);
    return new Response(null, { status: 404 });
  }

  private async init(request: Request): Promise<Response> {
    // JSON rusak diperlakukan sama dengan input yang gagal skema.
    const input = InitRoomInput.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      // Worker selalu mengirim input yang sudah divalidasi; sampai di sini berarti bug atau version skew.
      log.error("room_init_invalid", { detail: input.error.message });
      return new Response(null, { status: 400 });
    }
    if (this.state) return Response.json({ ok: false, reason: "pin_in_use" } satisfies InitRoomResult);

    const createdAt = Date.now();
    const { quiz, ...room } = input.data;
    const state: RoomState = {
      ...room,
      phase: "lobby",
      questionIndex: null,
      questionSentAt: null,
      deadlineAt: null,
      createdAt,
      startedAt: null,
      endedAt: null,
    };
    // Diisi sebelum await pertama, supaya init kedua untuk PIN yang sama langsung melihat room ini
    // (cek lalu tulis tanpa celah).
    this.state = state;
    this.quiz = quiz;
    await this.ctx.storage.put({ [StorageKey.quiz]: quiz, [StorageKey.state]: state });
    await this.ctx.storage.setAlarm(createdAt + LOBBY_IDLE_TIMEOUT_MS);
    log.info("room_created", { pin: state.pin, gameId: state.gameId, questions: quiz.questions.length });
    return Response.json({ ok: true } satisfies InitRoomResult);
  }

  private joinInfo(): Response {
    return Response.json({ status: this.joinStatus(), playerCount: this.players().length } satisfies JoinInfo);
  }

  private joinStatus(): JoinInfo["status"] {
    if (!this.state) return "not_found";
    if (this.state.phase !== "lobby") return "started";
    if (this.players().length >= MAX_PLAYERS_PER_ROOM) return "full";
    return "open";
  }

  // Bukan "connect": nama itu handler bawaan Durable Object untuk socket TCP.
  private acceptConnection(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") return new Response(null, { status: 426 });
    const route = RoomRoute.safeParse(request.headers.get(RoomHeader.route));
    if (!route.success) {
      log.error("connect_route_invalid", { route: request.headers.get(RoomHeader.route) });
      return new Response(null, { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    const isHost = route.data === "host";
    // Host yang bukan pemilik mendapat jawaban yang sama dengan room tidak ada, supaya PIN tidak bisa ditebak.
    if (!this.state || (isHost && request.headers.get(RoomHeader.hostId) !== this.state.hostId)) {
      // Browser tidak bisa membaca alasan penolakan HTTP saat upgrade, tapi bisa membaca close code.
      // accept() biasa, bukan acceptWebSocket: socket ini langsung ditutup dan tidak perlu hibernasi.
      // Dengan acceptWebSocket, close sebelum 101 terkirim baru sampai ke klien sekitar 11 detik kemudian
      // (diukur di wrangler dev); dengan accept() sekitar 200 ms.
      server.accept();
      server.close(CloseCode.ROOM_NOT_FOUND, "Room tidak ditemukan");
      return new Response(null, { status: 101, webSocket: client });
    }

    const connectedAt = Date.now();
    this.ctx.acceptWebSocket(server);
    this.attach(
      server,
      isHost
        ? { role: "pending_host", hostId: this.state.hostId, connectedAt }
        : { role: "pending_player", connectedAt },
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const attachment = this.sockets.get(ws);
    // Socket yang sudah dikeluarkan (diganti, basi, room ditutup) bisa masih mengirim sisa pesan.
    if (!attachment || !this.state) return;

    const taken = takeToken(this.buckets.get(ws), now);
    this.buckets.set(ws, taken.bucket);
    if (!taken.allowed) return this.close(ws, CloseCode.RATE_LIMITED, "Terlalu banyak pesan");

    if (attachment.role === "host" || attachment.role === "pending_host") {
      const decoded = decodeHostMessage(message);
      if (!decoded.ok) return this.reject(ws, decoded, false);
      this.invalidStreaks.delete(ws);
      return this.onHostMessage(ws, attachment.role === "pending_host", attachment.hostId, decoded.data);
    }

    const decoded = decodePlayerMessage(message);
    if (!decoded.ok) return this.reject(ws, decoded, true);
    this.invalidStreaks.delete(ws);
    return this.onPlayerMessage(ws, attachment.role === "pending_player", decoded.data, now);
  }

  private reject(ws: WebSocket, failure: DecodeFailure, fromPlayer: boolean): void {
    if (failure.reason === "unsupported_version") {
      this.sendError(ws, "UNSUPPORTED_VERSION", "Versi aplikasi sudah usang. Muat ulang halaman.");
      return this.close(ws, CloseCode.UNSUPPORTED_VERSION, "Versi protokol tidak didukung");
    }
    // Nickname salah ketik bukan pesan sampah, jadi tidak dihitung ke batas pesan rusak.
    const onlyNickname =
      failure.reason === "invalid_schema" &&
      failure.issuePaths.length > 0 &&
      failure.issuePaths.every((path) => path === "nickname");
    if (fromPlayer && onlyNickname) {
      return this.sendError(ws, "NICKNAME_INVALID", "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -");
    }

    const streak = (this.invalidStreaks.get(ws) ?? 0) + 1;
    this.invalidStreaks.set(ws, streak);
    this.sendError(ws, "BAD_MESSAGE", "Pesan tidak valid");
    if (streak >= MAX_CONSECUTIVE_INVALID_MESSAGES) this.close(ws, CloseCode.TOO_MANY_INVALID, "Terlalu banyak pesan rusak");
  }

  private async onPlayerMessage(ws: WebSocket, pending: boolean, message: PlayerMessage, now: number): Promise<void> {
    const opening = message.t === "join" || message.t === "resume";
    if (pending && !opening) return this.sendError(ws, "NOT_JOINED", "Masuk dulu dengan nickname");
    if (!pending && opening) return this.sendError(ws, "NOT_ALLOWED_NOW", "Kamu sudah masuk");
    const phase = this.state?.phase ?? "lobby";
    if (!isAllowedInPhase(message.t, phase)) return log.info("player_message_ignored", { t: message.t, phase });

    switch (message.t) {
      case "join":
        return this.join(ws, message.nickname, now);
      case "resume":
        return this.resume(ws, message.sessionToken, now);
      case "ack":
      case "answer":
      case "react":
        // Soal dikerjakan Hari 3, reaksi menyusul; pesan sah tapi belum ada yang menanganinya.
        return log.info("player_message_ignored", { t: message.t, phase });
      default:
        return message satisfies never;
    }
  }

  private async onHostMessage(ws: WebSocket, pending: boolean, hostId: string, message: HostMessage): Promise<void> {
    const opening = message.t === "host_hello";
    if (pending && !opening) return this.sendError(ws, "NOT_JOINED", "Kirim host_hello dulu");
    if (!pending && opening) return this.sendError(ws, "NOT_ALLOWED_NOW", "Layar host sudah tersambung");
    const phase = this.state?.phase ?? "lobby";
    if (!isAllowedInPhase(message.t, phase)) return this.sendError(ws, "NOT_ALLOWED_NOW", "Belum bisa dilakukan sekarang");

    switch (message.t) {
      case "host_hello":
        return this.hostHello(ws, hostId);
      case "start":
      case "next":
        return this.sendError(ws, "NOT_ALLOWED_NOW", "Tombol Mulai belum tersedia");
      case "kick":
        // Moderasi dikerjakan bersama kick di Hari 4.
        return log.info("host_message_ignored", { t: message.t, phase });
      case "end":
        return this.closeRoom("ended_by_host");
      default:
        return message satisfies never;
    }
  }

  private async join(ws: WebSocket, nickname: string, now: number): Promise<void> {
    // Hash dihitung sebelum pengecekan: await di tengah pengecekan membuka celah
    // dua join bersamaan dengan nickname yang sama sama-sama lolos.
    const sessionToken = newSessionToken();
    const tokenHash = await hashSessionToken(sessionToken);
    if (!this.sockets.has(ws)) return;

    if (this.players().length >= MAX_PLAYERS_PER_ROOM) {
      for (const [other, player] of this.players()) {
        if (this.isStaleSocket(other, player, now)) this.close(other, CloseCode.GOING_AWAY, "Koneksi tidak aktif");
      }
      if (this.players().length >= MAX_PLAYERS_PER_ROOM) {
        this.sendError(ws, "ROOM_FULL", "Room sudah penuh");
        return this.close(ws, CloseCode.ROOM_FULL, "Room sudah penuh");
      }
    }

    const key = nicknameKey(nickname);
    const holder = this.players().find(([, player]) => nicknameKey(player.nickname) === key);
    if (holder) {
      const [holderWs, holderPlayer] = holder;
      if (!this.isStaleSocket(holderWs, holderPlayer, now)) {
        return this.sendError(ws, "NICKNAME_TAKEN", "Nickname sudah dipakai pemain lain");
      }
      this.close(holderWs, CloseCode.GOING_AWAY, "Koneksi tidak aktif");
    }

    const player: PlayerAttachment = {
      role: "player",
      playerId: crypto.randomUUID(),
      nickname,
      tokenHash,
      // Mode tim belum bisa dipilih (teamMode selalu false), jadi ukuran tim tidak dipakai.
      teamSize: null,
      joinedAt: now,
      latencyMs: null,
      score: 0,
      streak: 0,
      answer: null,
    };
    this.attach(ws, player);
    const playerCount = this.players().length;
    this.send(ws, this.welcome(player, sessionToken));
    this.broadcast("host", { t: "player_joined", player: toRosterEntry(player), playerCount });
    this.broadcast("player", { t: "lobby", playerCount });
  }

  private async resume(ws: WebSocket, sessionToken: string, now: number): Promise<void> {
    const tokenHash = await hashSessionToken(sessionToken);
    if (!this.sockets.has(ws)) return;

    // Di lobby roster hanya ada di attachment socket yang masih terbuka. Resume di tahap lain: Hari 4.
    const previous = this.players().find(([other, player]) => other !== ws && player.tokenHash === tokenHash);
    if (!previous) {
      this.sendError(ws, "SESSION_INVALID", "Sesi tidak dikenal. Masuk lagi dengan nickname.");
      return this.close(ws, CloseCode.SESSION_INVALID, "Sesi tidak dikenal");
    }

    const [previousWs, player] = previous;
    // Pemain yang sama pindah socket, jadi host tidak dikirimi player_left.
    this.sockets.delete(previousWs);
    previousWs.close(CloseCode.REPLACED, "Tersambung dari tempat lain");
    // joinedAt diperbarui: socket baru belum pernah ping, dan tanda hidup socket lama tidak berlaku untuknya.
    const resumed: PlayerAttachment = { ...player, joinedAt: now };
    this.attach(ws, resumed);
    this.send(ws, this.welcome(resumed, null));
  }

  private hostHello(ws: WebSocket, hostId: string): void {
    const { state } = this.requireRoom();
    this.attach(ws, { role: "host", hostId });
    this.send(ws, {
      t: "host_welcome",
      v: PROTOCOL_VERSION,
      room: this.roomInfo(),
      phase: state.phase,
      players: this.players().map(([, player]) => toRosterEntry(player)),
      question: null,
      remainingMs: null,
      answered: 0,
    });
  }

  /** Room dibatalkan host atau lobby ditinggal: semua socket ditutup dan PIN bebas dipakai lagi. */
  private async closeRoom(reason: string): Promise<void> {
    const pin = this.state?.pin;
    const sockets = [...this.sockets.keys()];
    this.sockets.clear();
    this.state = null;
    this.quiz = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const ws of sockets) ws.close(CloseCode.ROOM_CLOSED, "Room ditutup");
    log.info("room_closed", { pin, reason });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  override async alarm(): Promise<void> {
    if (!this.state) return;
    if (this.state.phase !== "lobby") {
      // Alarm tahap soal dibuat di Hari 3; hari ini alarm hanya dipasang untuk lobby.
      log.error("alarm_unexpected_phase", { pin: this.state.pin, phase: this.state.phase });
      return;
    }
    const hostConnected = [...this.sockets.values()].some(
      (attachment) => attachment.role === "host" || attachment.role === "pending_host",
    );
    if (hostConnected) {
      await this.ctx.storage.setAlarm(Date.now() + LOBBY_IDLE_TIMEOUT_MS);
      return;
    }
    await this.closeRoom("lobby_idle");
  }

  /** Server menutup socket: keluarkan dari roster dulu, karena HP yang hilang sinyal tidak pernah membalas close. */
  private close(ws: WebSocket, code: number, reason: string): void {
    this.leave(ws);
    ws.close(code, reason);
  }

  private leave(ws: WebSocket): void {
    const attachment = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (attachment?.role !== "player") return;
    const playerCount = this.players().length;
    this.broadcast("host", { t: "player_left", playerId: attachment.playerId, kicked: false, playerCount });
    this.broadcast("player", { t: "lobby", playerCount });
  }

  private isStaleSocket(ws: WebSocket, player: PlayerAttachment, now: number): boolean {
    const lastPongAt = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null;
    return isStale(now, lastPongAt, player.joinedAt);
  }

  private players(): PlayerSocket[] {
    return [...this.sockets].filter((entry): entry is PlayerSocket => entry[1].role === "player");
  }

  private attach(ws: WebSocket, attachment: SocketAttachment): void {
    ws.serializeAttachment(attachment);
    this.sockets.set(ws, attachment);
  }

  private requireRoom(): { state: RoomState; quiz: QuizSnapshot } {
    if (!this.state || !this.quiz) throw new Error("GameRoom belum di-init");
    return { state: this.state, quiz: this.quiz };
  }

  private roomInfo(): RoomInfo {
    const { state, quiz } = this.requireRoom();
    return { pin: state.pin, scoringMode: state.scoringMode, teamMode: state.teamMode, questionCount: quiz.questions.length };
  }

  private welcome(player: PlayerAttachment, sessionToken: string | null): ServerMessage {
    return {
      t: "welcome",
      v: PROTOCOL_VERSION,
      playerId: player.playerId,
      nickname: player.nickname,
      ...(sessionToken === null ? {} : { sessionToken }),
      room: this.roomInfo(),
      snapshot: {
        phase: "lobby",
        question: null,
        remainingMs: null,
        answered: false,
        score: player.score,
        streak: player.streak,
        rank: null,
        playerCount: this.players().length,
      },
    };
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, { t: "error", code, message });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    sendText(ws, encodeServerMessage(message));
  }

  /** Encode sekali, kirim string yang sama ke semua socket dengan peran itu. */
  private broadcast(role: "player" | "host", message: ServerMessage): void {
    const text = encodeServerMessage(message);
    for (const [ws, attachment] of this.sockets) {
      if (attachment.role === role) sendText(ws, text);
    }
  }
}

function sendText(ws: WebSocket, text: string): void {
  try {
    ws.send(text);
  } catch (error) {
    // Socket yang sudah putus melempar di sini; webSocketClose yang membersihkannya.
    // Ditangkap per socket supaya satu socket rusak tidak menghentikan broadcast ke yang lain.
    log.error("send_failed", { error: String(error) });
  }
}

function toRosterEntry(player: PlayerAttachment): RosterEntry {
  return { playerId: player.playerId, nickname: player.nickname, teamSize: player.teamSize, connected: true };
}
