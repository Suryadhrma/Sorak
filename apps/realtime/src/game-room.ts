import { DurableObject } from "cloudflare:workers";
import {
  CloseCode,
  ENDED_RETENTION_MS,
  GRACE_MS,
  HEARTBEAT,
  InitRoomInput,
  LEADERBOARD_SIZE,
  LOBBY_IDLE_TIMEOUT_MS,
  MAX_CONSECUTIVE_INVALID_MESSAGES,
  MAX_PLAYERS_PER_ROOM,
  PODIUM_SIZE,
  PROTOCOL_VERSION,
  PendingAnswer,
  QuestionStatsList,
  QuizSnapshot,
  REVEAL_IDLE_TIMEOUT_MS,
  Roster,
  RoomControlPath,
  RoomHeader,
  RoomRoute,
  RoomState,
  Scoreboard,
  SocketAttachment,
  StorageKey,
  decodeHostMessage,
  decodePlayerMessage,
  encodeServerMessage,
  isAllowedInPhase,
  nicknameKey,
  pendingAnswerKey,
  toPublicQuestion,
  type DecodeResult,
  type ErrorCode,
  type HostMessage,
  type InitRoomResult,
  type JoinInfo,
  type PlayerAttachment,
  type PlayerMessage,
  type QuestionStats,
  type RoomInfo,
  type RosterEntry,
  type ScoringMode,
  type ServerMessage,

} from "@sorak/shared";
import { compensateAnswerTime, updateLatency } from "./latency.ts";
import { log } from "./log.ts";
import { isNicknameAllowed } from "./moderation.ts";
import { nextPhase, type PhaseEvent, type PhaseTarget } from "./phase.ts";
import { takeToken, type TokenBucket } from "./rate-limit.ts";
import { emptyScore, rankPlayers, revealQuestion } from "./reveal.ts";
import type { ScoredMode } from "./scoring.ts";
import { hashSessionToken, newSessionToken } from "./session-token.ts";
import { isStale } from "./stale.ts";

type DecodeFailure = Extract<DecodeResult<unknown>, { ok: false }>;
type PlayerSocket = [WebSocket, PlayerAttachment];
type AnswerMessage = Extract<PlayerMessage, { t: "answer" }>;
type StoredRosterEntry = Roster[number];

/**
 * Cangkang imperatif game: membaca state, memanggil fungsi murni (phase.ts, scoring.ts, reveal.ts),
 * lalu menulis storage dan mengirim pesan. Aturan permainannya sendiri tidak ada di file ini.
 */
export class GameRoom extends DurableObject<Env> {
  private state: RoomState | null = null;
  private quiz: QuizSnapshot | null = null;
  /** Snapshot pemain saat Mulai; satu-satunya daftar peserta selama game, termasuk yang sudah putus. */
  private roster: Roster = [];
  private scoreboard: Scoreboard = {};
  private qstats: QuestionStats[] = [];
  /** Jawaban soal aktif dari pemain yang socket-nya sudah tertutup (key pending:<playerId>:<q>). */
  private readonly pendingAnswers = new Map<string, PendingAnswer>();
  /**
   * Socket hidup: satu-satunya sumber kebenaran siapa yang tersambung, dibangun ulang dari attachment
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
    const stored = await this.ctx.storage.get([
      StorageKey.state,
      StorageKey.quiz,
      StorageKey.roster,
      StorageKey.scoreboard,
      StorageKey.qstats,
    ]);
    const state = stored.get(StorageKey.state);
    const quiz = stored.get(StorageKey.quiz);
    this.state = state === undefined ? null : RoomState.parse(state);
    this.quiz = quiz === undefined ? null : QuizSnapshot.parse(quiz);
    this.roster = Roster.parse(stored.get(StorageKey.roster) ?? []);
    this.scoreboard = Scoreboard.parse(stored.get(StorageKey.scoreboard) ?? {});
    this.qstats = QuestionStatsList.parse(stored.get(StorageKey.qstats) ?? []);
    for (const value of (await this.ctx.storage.list({ prefix: StorageKey.pendingPrefix })).values()) {
      const answer = PendingAnswer.parse(value);
      this.pendingAnswers.set(answer.playerId, answer);
    }

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
    if (input.data.scoringMode === "confidence") {
      log.error("room_init_invalid", { detail: "Taruhan Yakin belum didukung" });
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
    // Socket yang sudah dikeluarkan (diganti, basi, di-kick, room ditutup) bisa masih mengirim sisa pesan.
    if (!attachment || attachment.role === "replaced" || !this.state) return;

    const taken = takeToken(this.buckets.get(ws), now);
    this.buckets.set(ws, taken.bucket);
    if (!taken.allowed) return this.close(ws, CloseCode.RATE_LIMITED, "Terlalu banyak pesan");

    if (attachment.role === "host" || attachment.role === "pending_host") {
      const decoded = decodeHostMessage(message);
      if (!decoded.ok) return this.reject(ws, decoded, false);
      this.invalidStreaks.delete(ws);
      return this.onHostMessage(ws, attachment.role === "pending_host", attachment.hostId, decoded.data, now);
    }

    const decoded = decodePlayerMessage(message);
    if (!decoded.ok) return this.reject(ws, decoded, true);
    this.invalidStreaks.delete(ws);
    return this.onPlayerMessage(ws, attachment, decoded.data, now);
  }

  private async reject(ws: WebSocket, failure: DecodeFailure, fromPlayer: boolean): Promise<void> {
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
    return this.badMessage(ws);
  }

  private async badMessage(ws: WebSocket): Promise<void> {
    const streak = (this.invalidStreaks.get(ws) ?? 0) + 1;
    this.invalidStreaks.set(ws, streak);
    this.sendError(ws, "BAD_MESSAGE", "Pesan tidak valid");
    if (streak >= MAX_CONSECUTIVE_INVALID_MESSAGES) {
      await this.close(ws, CloseCode.TOO_MANY_INVALID, "Terlalu banyak pesan rusak");
    }
  }

  private async onPlayerMessage(ws: WebSocket, attachment: SocketAttachment, message: PlayerMessage, now: number): Promise<void> {
    const pending = attachment.role === "pending_player";
    const opening = message.t === "join" || message.t === "resume";
    if (pending && !opening) return this.sendError(ws, "NOT_JOINED", "Masuk dulu dengan nickname");
    if (!pending && opening) return this.sendError(ws, "NOT_ALLOWED_NOW", "Kamu sudah masuk");
    const phase = this.state?.phase ?? "lobby";
    if (message.t === "join" && phase !== "lobby") return this.refuseLateJoin(ws);
    if (!isAllowedInPhase(message.t, phase)) return log.info("player_message_ignored", { t: message.t, phase });

    switch (message.t) {
      case "join":
        return this.join(ws, message.nickname, now);
      case "resume":
        return this.resume(ws, message.sessionToken, now);
      case "answer":
        if (attachment.role !== "player") return;
        return this.answer(ws, attachment, message, now);
      case "ack":
        if (attachment.role !== "player") return;
        return this.ack(ws, attachment, message.q, now);
      case "react":
        // Tombol Sorak dikerjakan Hari 5.
        return log.info("player_message_ignored", { t: message.t, phase });
      default:
        return message satisfies never;
    }
  }

  /** Pemain baru hanya bisa join di lobby; pemain lama kembali lewat resume. */
  private async refuseLateJoin(ws: WebSocket): Promise<void> {
    this.sendError(ws, "GAME_ALREADY_STARTED", "Permainan sudah dimulai.");
    return this.close(ws, CloseCode.GAME_ALREADY_STARTED, "Permainan sudah dimulai");
  }

  private async onHostMessage(ws: WebSocket, pending: boolean, hostId: string, message: HostMessage, now: number): Promise<void> {
    const opening = message.t === "host_hello";
    if (pending && !opening) return this.sendError(ws, "NOT_JOINED", "Kirim host_hello dulu");
    if (!pending && opening) return this.sendError(ws, "NOT_ALLOWED_NOW", "Layar host sudah tersambung");
    const phase = this.state?.phase ?? "lobby";
    if (!isAllowedInPhase(message.t, phase)) return this.sendError(ws, "NOT_ALLOWED_NOW", "Belum bisa dilakukan sekarang");

    switch (message.t) {
      case "host_hello":
        return this.hostHello(ws, hostId, now);
      case "start":
        return this.startGame(ws, now);
      case "next":
        return this.next(now);
      case "kick":
        return this.kick(ws, message.playerId);
      case "end":
        if (phase === "lobby") return this.closeRoom("cancelled_by_host");
        return this.endGame("end", now);
      default:
        return message satisfies never;
    }
  }

  private async join(ws: WebSocket, nickname: string, now: number): Promise<void> {
    // Kata mana yang kena tidak disebut, supaya pesan error tidak jadi alat mencari celah filter.
    if (!isNicknameAllowed(nickname)) {
      return this.sendError(ws, "NICKNAME_REJECTED", "Nama ini tidak bisa dipakai. Coba nama lain.");
    }
    // Hash dihitung sebelum pengecekan: await di tengah pengecekan membuka celah
    // dua join bersamaan dengan nickname yang sama sama-sama lolos.
    const sessionToken = newSessionToken();
    const tokenHash = await hashSessionToken(sessionToken);
    if (!this.sockets.has(ws)) return;

    if (this.players().length >= MAX_PLAYERS_PER_ROOM) {
      for (const [other, player] of this.players()) {
        if (this.isStaleSocket(other, player, now)) await this.close(other, CloseCode.GOING_AWAY, "Koneksi tidak aktif");
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
      await this.close(holderWs, CloseCode.GOING_AWAY, "Koneksi tidak aktif");
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
      ackedQ: null,
      score: 0,
      streak: 0,
      answer: null,
    };
    this.attach(ws, player);
    const playerCount = this.players().length;
    this.send(ws, this.welcome(player, sessionToken, now));
    this.broadcast("host", { t: "player_joined", player: toRosterEntry(player, true), playerCount });
    this.broadcast("player", { t: "lobby", playerCount });
  }

  private async resume(ws: WebSocket, sessionToken: string, now: number): Promise<void> {
    const tokenHash = await hashSessionToken(sessionToken);
    if (!this.sockets.has(ws)) return;
    if (this.state?.phase !== "lobby") return this.resumeInGame(ws, tokenHash, now);

    // Di lobby roster hanya ada di attachment socket yang masih terbuka.
    const previous = this.players().find(([other, player]) => other !== ws && player.tokenHash === tokenHash);
    if (!previous) {
      this.sendError(ws, "SESSION_INVALID", "Sesi tidak dikenal. Masuk lagi dengan nickname.");
      return this.close(ws, CloseCode.SESSION_INVALID, "Sesi tidak dikenal");
    }

    const [previousWs, player] = previous;
    // Pemain yang sama pindah socket, jadi host tidak dikirimi player_left.
    this.replaceSocket(previousWs, CloseCode.REPLACED, "Tersambung dari tempat lain");
    // joinedAt diperbarui: socket baru belum pernah ping, dan tanda hidup socket lama tidak berlaku untuknya.
    const resumed: PlayerAttachment = { ...player, joinedAt: now };
    this.attach(ws, resumed);
    this.send(ws, this.welcome(resumed, null, now));
  }

  /**
   * Sampel jeda sinyal: soal dikirim di questionSentAt, ack tiba sekarang. Satu soal hanya menyumbang satu
   * sampel (ackedQ), supaya ack berulang dengan jeda panjang tidak bisa membesarkan estimasi jeda.
   * Tanpa tulis storage: latency hidup di attachment.
   */
  private ack(ws: WebSocket, player: PlayerAttachment, q: number, now: number): void {
    const { state } = this.requireRoom();
    if (q !== state.questionIndex || state.questionSentAt === null || player.ackedQ === q) return;
    const latencyMs = updateLatency(player.latencyMs, now - state.questionSentAt);
    this.attach(ws, { ...player, latencyMs, ackedQ: q });
  }

  /**
   * Pemain kembali di tengah game, tanpa tulis storage: identitas dari roster, skor dari scoreboard, dan jawaban
   * aktif dari socket lama (kalau masih terbuka) atau dari key pending. Snapshot di welcome langsung membawa HP
   * ke layar yang benar; pesan terakhir yang mungkin terlewat (result, final) dikirim ulang.
   */
  private async resumeInGame(ws: WebSocket, tokenHash: string, now: number): Promise<void> {
    const { state } = this.requireRoom();
    // Pemain yang di-kick sudah dihapus dari roster, jadi token-nya juga ditolak di sini.
    const entry = this.roster.find((player) => player.tokenHash === tokenHash);
    if (!entry) {
      this.sendError(ws, "SESSION_INVALID", "Sesi tidak dikenal.");
      return this.close(ws, CloseCode.SESSION_INVALID, "Sesi tidak dikenal");
    }

    const q = state.questionIndex;
    const live = state.phase === "question" || state.phase === "grace";
    const previous = this.players().find(([other, player]) => other !== ws && player.playerId === entry.playerId);
    let carried: Pick<PlayerAttachment, "answer" | "latencyMs" | "ackedQ"> = { answer: null, latencyMs: null, ackedQ: null };
    if (previous) {
      const [previousWs, player] = previous;
      carried = { answer: player.answer, latencyMs: player.latencyMs, ackedQ: player.ackedQ };
      this.replaceSocket(previousWs, CloseCode.REPLACED, "Tersambung dari tempat lain");
    } else if (live) {
      // Key pending tidak dihapus: reveal sudah membuang duplikat, dan menghapusnya hanya menambah satu tulis.
      const pending = this.pendingAnswers.get(entry.playerId);
      if (pending) carried = { ...carried, answer: { q: pending.q, choice: pending.choice, tMs: pending.tMs, confidence: pending.confidence } };
    }

    const score = this.scoreboard[entry.playerId];
    const player: PlayerAttachment = {
      role: "player",
      playerId: entry.playerId,
      nickname: entry.nickname,
      tokenHash: entry.tokenHash,
      teamSize: entry.teamSize,
      joinedAt: now,
      latencyMs: carried.latencyMs,
      ackedQ: carried.ackedQ,
      score: score?.score ?? 0,
      streak: score?.streak ?? 0,
      answer: live && carried.answer?.q === q ? carried.answer : null,
    };
    this.attach(ws, player);
    this.send(ws, this.welcome(player, null, now));
    if (state.phase === "reveal" && q !== null) this.send(ws, this.resultMessage(q, player.playerId, this.ranks()));
    if (state.phase === "ended") this.send(ws, this.finalMessage(player.playerId, this.ranks()));
    this.broadcast("host", { t: "player_joined", player: toRosterEntry(entry, true), playerCount: this.roster.length });
  }

  /**
   * Guru mengeluarkan pemain. Di lobby cukup menutup socket (tanpa daftar hitam: anak yang sama bisa join lagi
   * dengan nama lain, dan guru cukup kick sekali lagi). Di tengah game pemain dihapus dari roster dan scoreboard
   * dalam satu put, sehingga token-nya tidak bisa dipakai resume lagi.
   */
  private async kick(ws: WebSocket, playerId: string): Promise<void> {
    const { state } = this.requireRoom();
    const socket = this.players().find(([, player]) => player.playerId === playerId);

    if (state.phase === "lobby") {
      if (!socket) return this.sendError(ws, "NOT_ALLOWED_NOW", "Pemain tidak ditemukan");
      this.replaceSocket(socket[0], CloseCode.KICKED, "Dikeluarkan oleh guru");
      const playerCount = this.players().length;
      this.broadcast("host", { t: "player_left", playerId, kicked: true, playerCount });
      this.broadcast("player", { t: "lobby", playerCount });
      return;
    }

    if (!this.roster.some((player) => player.playerId === playerId)) {
      return this.sendError(ws, "NOT_ALLOWED_NOW", "Pemain tidak ditemukan");
    }
    this.roster = this.roster.filter((player) => player.playerId !== playerId);
    const { [playerId]: _kicked, ...scoreboard } = this.scoreboard;
    this.scoreboard = scoreboard;
    await this.ctx.storage.put({ [StorageKey.roster]: this.roster, [StorageKey.scoreboard]: this.scoreboard });
    const pending = this.pendingAnswers.get(playerId);
    if (pending) {
      this.pendingAnswers.delete(playerId);
      await this.ctx.storage.delete(pendingAnswerKey(playerId, pending.q));
    }
    if (socket) this.replaceSocket(socket[0], CloseCode.KICKED, "Dikeluarkan oleh guru");
    this.broadcast("host", { t: "player_left", playerId, kicked: true, playerCount: this.roster.length });
    log.info("player_kicked", { pin: state.pin, phase: state.phase });
  }

  /** Socket lama ditandai replaced dulu, baru ditutup, supaya webSocketClose-nya tidak menulis pending atau player_left. */
  private replaceSocket(ws: WebSocket, code: number, reason: string): void {
    this.attach(ws, { role: "replaced" });
    ws.close(code, reason);
  }

  private async startGame(ws: WebSocket, now: number): Promise<void> {
    const players = this.players();
    if (players.length === 0) return this.sendError(ws, "NOT_ALLOWED_NOW", "Belum ada pemain");
    if (!this.transition("start")) return;

    this.roster = players.map(([, player]) => toStoredRosterEntry(player));
    this.scoreboard = {};
    this.qstats = [];
    await this.startQuestion(0, now, true);
    log.info("game_started", { pin: this.state?.pin, players: this.roster.length });
  }

  private async startQuestion(index: number, now: number, firstQuestion: boolean): Promise<void> {
    const { state, quiz } = this.requireRoom();
    const question = quiz.questions[index];
    if (!question) throw new Error(`soal ${index} tidak ada di kuis`);

    const deadlineAt = now + question.timeLimitSec * 1000;
    this.state = {
      ...state,
      phase: "question",
      questionIndex: index,
      questionSentAt: now,
      deadlineAt,
      startedAt: state.startedAt ?? now,
    };
    this.pendingAnswers.clear();
    for (const [socket, player] of this.players()) this.attach(socket, { ...player, answer: null });

    await this.ctx.storage.put({
      [StorageKey.state]: this.state,
      // Roster ditulis sekali saja selama game, bersama soal pertama.
      ...(firstQuestion ? { [StorageKey.roster]: this.roster } : {}),
    });
    await this.ctx.storage.setAlarm(deadlineAt);
    this.broadcastAll({ t: "question", ...toPublicQuestion(question, index, quiz.questions.length) });
  }

  private async answer(ws: WebSocket, player: PlayerAttachment, message: AnswerMessage, now: number): Promise<void> {
    const { state, quiz } = this.requireRoom();
    if (message.q !== state.questionIndex) {
      return log.info("answer_ignored", { reason: "not_active_question", q: message.q, active: state.questionIndex });
    }
    const question = quiz.questions[message.q];
    if (!question) throw new Error(`soal aktif ${message.q} tidak ada di kuis`);
    if (message.choice >= question.options.length) return this.badMessage(ws);

    // Idempotent: tombol ditekan berkali-kali tetap satu jawaban, dan klien tetap mendapat konfirmasi.
    if (player.answer?.q === message.q) return this.send(ws, { t: "answer_received", q: message.q });

    // Klaim waktu dari HP dipakai hanya di dalam rentang yang bisa dibuktikan server (latency.ts). Jawaban di masa
    // toleransi (grace) lewat rumus yang sama: tServer-nya sudah melewati T, jadi poin kecepatannya kecil.
    const tMs = compensateAnswerTime({
      elapsedMs: message.elapsedMs,
      tServerMs: now - (state.questionSentAt ?? now),
      latencyMs: player.latencyMs,
      timeLimitMs: question.timeLimitSec * 1000,
    });
    this.attach(ws, { ...player, answer: { q: message.q, choice: message.choice, tMs, confidence: null } });
    this.send(ws, { t: "answer_received", q: message.q });
    this.broadcast("host", { t: "answer_count", q: message.q, answered: this.answeredCount(message.q), total: this.roster.length });

    const openPlayers = this.players();
    // Tanpa satu pun pemain tersambung, "semua sudah menjawab" selalu benar; tunggu alarm deadline saja.
    const everyoneAnswered = openPlayers.length > 0 && openPlayers.every(([, other]) => other.answer?.q === message.q);
    if (state.phase === "question" && everyoneAnswered) await this.toGrace("all_answered", now);
  }

  private async toGrace(event: Extract<PhaseEvent, "deadline" | "all_answered">, now: number): Promise<void> {
    const { state } = this.requireRoom();
    if (!this.transition(event) || state.questionIndex === null) return;
    this.state = { ...state, phase: "grace" };
    await this.ctx.storage.put(StorageKey.state, this.state);
    // Menggantikan alarm deadline: satu objek hanya punya satu alarm.
    await this.ctx.storage.setAlarm(now + GRACE_MS);
    this.broadcastAll({ t: "grace", q: state.questionIndex, ms: GRACE_MS });
  }

  private async reveal(now: number): Promise<void> {
    const { state, quiz } = this.requireRoom();
    const q = state.questionIndex;
    const question = q === null ? undefined : quiz.questions[q];
    if (q === null || !question || !this.transition("grace_over")) return;

    const answers = [...this.openAnswers(q), ...this.pendingAnswers.values()];
    const revealed = revealQuestion({
      question,
      questionIndex: q,
      mode: scoredMode(state.scoringMode),
      roster: this.roster,
      scoreboard: this.scoreboard,
      answers,
    });
    this.scoreboard = revealed.scoreboard;
    this.qstats[q] = revealed.stats;
    this.state = { ...state, phase: "reveal", deadlineAt: null };

    await this.ctx.storage.put({
      [StorageKey.state]: this.state,
      [StorageKey.scoreboard]: this.scoreboard,
      [StorageKey.qstats]: this.qstats,
    });
    const pendingKeys = [...this.pendingAnswers.keys()].map((playerId) => pendingAnswerKey(playerId, q));
    if (pendingKeys.length > 0) await this.ctx.storage.delete(pendingKeys);
    this.pendingAnswers.clear();
    await this.ctx.storage.setAlarm(now + REVEAL_IDLE_TIMEOUT_MS);

    // Pesan result dibangun dari scoreboard (fungsi yang sama dengan pengiriman ulang saat resume),
    // jadi pemain yang tersambung lagi di reveal menerima result yang persis sama.
    const ranks = this.ranks();
    for (const [socket, player] of this.players()) {
      const score = this.scoreboard[player.playerId];
      if (!score) continue;
      this.attach(socket, { ...player, score: score.score, streak: score.streak });
      this.send(socket, this.resultMessage(q, player.playerId, ranks));
    }
    this.broadcast("host", this.revealMessage(q));
  }

  private async next(now: number): Promise<void> {
    const { state, quiz } = this.requireRoom();
    const nextIndex = (state.questionIndex ?? -1) + 1;
    if (nextIndex >= quiz.questions.length) return this.endGame("next_last", now);
    if (!this.transition("next")) return;
    await this.startQuestion(nextIndex, now, false);
  }

  /** Game selesai: soal terakhir, host mengakhiri, atau reveal ditinggal. Soal yang belum di-reveal tidak dinilai. */
  private async endGame(event: Extract<PhaseEvent, "next_last" | "end" | "idle_timeout">, now: number): Promise<void> {
    const { state } = this.requireRoom();
    if (!this.transition(event)) return;
    this.state = { ...state, phase: "ended", deadlineAt: null, endedAt: now };
    this.pendingAnswers.clear();
    await this.ctx.storage.put(StorageKey.state, this.state);
    await this.ctx.storage.setAlarm(now + ENDED_RETENTION_MS);

    const ranks = this.ranks();
    for (const [socket, player] of this.players()) this.send(socket, this.finalMessage(player.playerId, ranks));
    this.broadcast("host", this.podiumMessage());
    log.info("game_ended", { pin: state.pin, reason: event, players: this.roster.length });
  }

  private hostHello(ws: WebSocket, hostId: string, now: number): void {
    const { state, quiz } = this.requireRoom();
    this.attach(ws, { role: "host", hostId });
    const q = state.questionIndex;
    const question = q === null ? undefined : quiz.questions[q];
    const live = state.phase === "question" || state.phase === "grace";
    // Di reveal soal tetap dikirim (tanpa kunci jawaban) supaya layar guru yang di-refresh bisa menampilkan teks pilihan.
    const showQuestion = live || state.phase === "reveal";
    this.send(ws, {
      t: "host_welcome",
      v: PROTOCOL_VERSION,
      room: this.roomInfo(),
      phase: state.phase,
      players: this.hostRoster(),
      question: showQuestion && question && q !== null ? toPublicQuestion(question, q, quiz.questions.length) : null,
      remainingMs: state.phase === "question" && state.deadlineAt !== null ? Math.max(0, state.deadlineAt - now) : null,
      answered: live && q !== null ? this.answeredCount(q) : 0,
    });
    // Layar guru bisa di-refresh kapan saja: tahap reveal dan ended dikirim ulang dari storage.
    if (state.phase === "reveal" && q !== null) this.send(ws, this.revealMessage(q));
    if (state.phase === "ended") this.send(ws, this.podiumMessage());
  }

  /** Room dibatalkan di lobby atau selesai dibersihkan: semua socket ditutup dan PIN bebas dipakai lagi. */
  private async closeRoom(reason: string): Promise<void> {
    if (this.state?.phase !== "lobby" && !this.transition("retention_over")) return;
    const pin = this.state?.pin;
    const sockets = [...this.sockets.keys()];
    this.sockets.clear();
    this.state = null;
    this.quiz = null;
    this.roster = [];
    this.scoreboard = {};
    this.qstats = [];
    this.pendingAnswers.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const ws of sockets) ws.close(CloseCode.ROOM_CLOSED, "Room ditutup");
    log.info("room_closed", { pin, reason });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async alarm(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();
    switch (this.state.phase) {
      case "lobby":
        return this.lobbyAlarm(now);
      case "question":
        return this.toGrace("deadline", now);
      case "grace":
        return this.reveal(now);
      case "reveal":
        return this.endGame("idle_timeout", now);
      case "ended":
        return this.closeRoom("retention_over");
      default:
        return this.state.phase satisfies never;
    }
  }

  private async lobbyAlarm(now: number): Promise<void> {
    const hostConnected = [...this.sockets.values()].some(
      (attachment) => attachment.role === "host" || attachment.role === "pending_host",
    );
    if (hostConnected) {
      await this.ctx.storage.setAlarm(now + LOBBY_IDLE_TIMEOUT_MS);
      return;
    }
    await this.closeRoom("lobby_idle");
  }

  /** Server menutup socket: keluarkan dari roster dulu, karena HP yang hilang sinyal tidak pernah membalas close. */
  private async close(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
    await this.leave(ws);
  }

  private async leave(ws: WebSocket): Promise<void> {
    const attachment = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (attachment?.role !== "player" || !this.state) return;

    const { phase, questionIndex } = this.state;
    const answer = attachment.answer;
    // Jawaban soal aktif dari pemain yang putus disimpan sebelum attachment hilang, supaya tetap dinilai di reveal.
    // Satu-satunya tulis storage per pemain, dan hanya untuk yang putus.
    if ((phase === "question" || phase === "grace") && answer && answer.q === questionIndex) {
      const pending: PendingAnswer = { ...answer, playerId: attachment.playerId };
      this.pendingAnswers.set(attachment.playerId, pending);
      await this.ctx.storage.put(pendingAnswerKey(attachment.playerId, answer.q), pending);
    }

    const playerCount = phase === "lobby" ? this.players().length : this.roster.length;
    this.broadcast("host", { t: "player_left", playerId: attachment.playerId, kicked: false, playerCount });
    if (phase === "lobby") this.broadcast("player", { t: "lobby", playerCount });
  }

  /** Mengubah tahap lewat tabel transisi; transisi yang tidak sah dicatat dan tidak mengubah apa pun. */
  private transition(event: PhaseEvent): PhaseTarget | null {
    const phase = this.state?.phase;
    if (!phase) return null;
    const target = nextPhase(phase, event);
    if (!target) log.error("phase_transition_invalid", { pin: this.state?.pin, phase, event });
    return target;
  }

  private openAnswers(q: number): PendingAnswer[] {
    return this.players().flatMap(([, player]) =>
      player.answer?.q === q ? [{ ...player.answer, playerId: player.playerId }] : [],
    );
  }

  private answeredCount(q: number): number {
    const answered = new Set(this.openAnswers(q).map((answer) => answer.playerId));
    for (const answer of this.pendingAnswers.values()) if (answer.q === q) answered.add(answer.playerId);
    return answered.size;
  }

  /** Lobby: pemain yang tersambung. Selama game: seluruh roster, ditandai tersambung atau tidak. */
  private hostRoster(): RosterEntry[] {
    const players = this.players();
    if (this.state?.phase === "lobby") return players.map(([, player]) => toRosterEntry(player, true));
    const connected = new Set(players.map(([, player]) => player.playerId));
    return this.roster.map((player) => toRosterEntry(player, connected.has(player.playerId)));
  }

  private revealMessage(q: number): ServerMessage {
    const { quiz } = this.requireRoom();
    const question = quiz.questions[q];
    const stats = this.qstats[q];
    if (!question || !stats) throw new Error(`statistik soal ${q} belum ada`);
    return {
      t: "reveal",
      q,
      correctIndex: question.correctIndex,
      counts: stats.answerCounts,
      answered: stats.answered,
      total: this.roster.length,
      leaderboard: rankPlayers(this.roster, this.scoreboard).slice(0, LEADERBOARD_SIZE),
      isLastQuestion: q === quiz.questions.length - 1,
    };
  }

  private podiumMessage(): ServerMessage {
    const { state } = this.requireRoom();
    return {
      t: "podium",
      gameId: state.gameId,
      top: rankPlayers(this.roster, this.scoreboard).slice(0, PODIUM_SIZE),
      playerCount: this.roster.length,
    };
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

  /** Snapshot tahap saat ini dari sudut pandang pemain ini: HP langsung menampilkan layar yang benar. */
  private welcome(player: PlayerAttachment, sessionToken: string | null, now: number): ServerMessage {
    const { state, quiz } = this.requireRoom();
    const q = state.questionIndex;
    const question = q === null ? undefined : quiz.questions[q];
    const live = state.phase === "question" || state.phase === "grace";
    // Peringkat baru ada setelah reveal pertama (scoreboard terisi).
    const rank = Object.keys(this.scoreboard).length === 0 ? null : (this.ranks().get(player.playerId) ?? null);
    return {
      t: "welcome",
      v: PROTOCOL_VERSION,
      playerId: player.playerId,
      nickname: player.nickname,
      ...(sessionToken === null ? {} : { sessionToken }),
      room: this.roomInfo(),
      snapshot: {
        phase: state.phase,
        question: live && question && q !== null ? toPublicQuestion(question, q, quiz.questions.length) : null,
        remainingMs: state.phase === "question" && state.deadlineAt !== null ? Math.max(0, state.deadlineAt - now) : null,
        answered: live && q !== null && player.answer?.q === q,
        score: player.score,
        streak: player.streak,
        rank,
        playerCount: state.phase === "lobby" ? this.players().length : this.roster.length,
      },
    };
  }

  /** Peringkat semua pemain roster (competition ranking yang sama dengan reveal). */
  private ranks(): Map<string, number> {
    return new Map(rankPlayers(this.roster, this.scoreboard).map((entry) => [entry.playerId, entry.rank]));
  }

  /** Hasil soal q untuk satu pemain, dibangun dari scoreboard: dipakai saat reveal dan saat resume di tahap reveal. */
  private resultMessage(q: number, playerId: string, ranks: Map<string, number>): ServerMessage {
    const { quiz } = this.requireRoom();
    const question = quiz.questions[q];
    if (!question) throw new Error(`soal ${q} tidak ada di kuis`);
    const score = this.scoreboard[playerId] ?? emptyScore();
    return {
      t: "result",
      q,
      outcome: score.lastOutcome ?? "no_answer",
      correctIndex: question.correctIndex,
      points: score.lastPoints,
      score: score.score,
      rank: ranks.get(playerId) ?? this.roster.length,
      streak: score.streak,
    };
  }

  /** Skor akhir satu pemain: dipakai saat game selesai dan saat resume di tahap ended. */
  private finalMessage(playerId: string, ranks: Map<string, number>): ServerMessage {
    const { state } = this.requireRoom();
    const score = this.scoreboard[playerId] ?? emptyScore();
    return {
      t: "final",
      gameId: state.gameId,
      score: score.score,
      rank: ranks.get(playerId) ?? this.roster.length,
      playerCount: this.roster.length,
      highlights: {
        bestStreak: score.bestStreak,
        confidentCorrect: score.confidentCorrect,
        biggestRankClimb: score.biggestRankClimb,
        fastestCorrectMs: score.fastestCorrectMs,
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

  private broadcastAll(message: ServerMessage): void {
    const text = encodeServerMessage(message);
    for (const [ws, attachment] of this.sockets) {
      if (attachment.role === "player" || attachment.role === "host") sendText(ws, text);
    }
  }
}

/** init menolak Taruhan Yakin sampai Hari 7, jadi mode lain di sini berarti state rusak. */
function scoredMode(mode: ScoringMode): ScoredMode {
  if (mode === "confidence") throw new Error("Taruhan Yakin belum didukung GameRoom");
  return mode;
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

function toRosterEntry(player: StoredRosterEntry, connected: boolean): RosterEntry {
  return { playerId: player.playerId, nickname: player.nickname, teamSize: player.teamSize, connected };
}

function toStoredRosterEntry(player: PlayerAttachment): StoredRosterEntry {
  return { playerId: player.playerId, nickname: player.nickname, tokenHash: player.tokenHash, teamSize: player.teamSize };
}
