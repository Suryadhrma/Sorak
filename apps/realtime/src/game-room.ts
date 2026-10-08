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
import { log } from "./log.ts";
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
    // Socket yang sudah dikeluarkan (diganti, basi, room ditutup) bisa masih mengirim sisa pesan.
    if (!attachment || !this.state) return;

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
    if (opening && phase !== "lobby") return this.refuseLateArrival(ws, message.t);
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
      case "react":
        // ack dipakai untuk mengukur latency mulai Hari 4; reaksi menyusul.
        return log.info("player_message_ignored", { t: message.t, phase });
      default:
        return message satisfies never;
    }
  }

  /** Join dan resume hanya di lobby; resume di tengah game dikerjakan Hari 4. */
  private async refuseLateArrival(ws: WebSocket, type: "join" | "resume"): Promise<void> {
    const message =
      type === "join" ? "Permainan sudah dimulai." : "Masuk ulang di tengah game tersedia di versi berikutnya.";
    this.sendError(ws, "GAME_ALREADY_STARTED", message);
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
        // Moderasi dikerjakan bersama kick di Hari 4.
        return log.info("host_message_ignored", { t: message.t, phase });
      case "end":
        if (phase === "lobby") return this.closeRoom("cancelled_by_host");
        return this.endGame("end", now);
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
      score: 0,
      streak: 0,
      answer: null,
    };
    this.attach(ws, player);
    const playerCount = this.players().length;
    this.send(ws, this.welcome(player, sessionToken));
    this.broadcast("host", { t: "player_joined", player: toRosterEntry(player, true), playerCount });
    this.broadcast("player", { t: "lobby", playerCount });
  }

  private async resume(ws: WebSocket, sessionToken: string, now: number): Promise<void> {
    const tokenHash = await hashSessionToken(sessionToken);
    if (!this.sockets.has(ws)) return;

    // Di lobby roster hanya ada di attachment socket yang masih terbuka.
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

    const timeLimitMs = question.timeLimitSec * 1000;
    // Jam server saja sampai kompensasi latency Hari 4; jawaban di masa toleransi dinilai benar/salah dengan t = T.
    const tMs = state.phase === "grace" ? timeLimitMs : Math.min(Math.max(now - (state.questionSentAt ?? now), 0), timeLimitMs);
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

    const results = new Map(revealed.results.map((result) => [result.playerId, result]));
    for (const [socket, player] of this.players()) {
      const result = results.get(player.playerId);
      if (!result) continue;
      this.attach(socket, { ...player, score: result.score, streak: result.streak });
      this.send(socket, { t: "result", q, correctIndex: question.correctIndex, ...result });
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

    const ranked = rankPlayers(this.roster, this.scoreboard);
    for (const [socket, player] of this.players()) {
      const entry = ranked.find((candidate) => candidate.playerId === player.playerId);
      const score = this.scoreboard[player.playerId] ?? emptyScore();
      this.send(socket, {
        t: "final",
        gameId: state.gameId,
        score: score.score,
        rank: entry?.rank ?? ranked.length,
        playerCount: this.roster.length,
        highlights: {
          bestStreak: score.bestStreak,
          confidentCorrect: score.confidentCorrect,
          biggestRankClimb: score.biggestRankClimb,
          fastestCorrectMs: score.fastestCorrectMs,
        },
      });
    }
    this.broadcast("host", this.podiumMessage());
    log.info("game_ended", { pin: state.pin, reason: event, players: this.roster.length });
  }

  private hostHello(ws: WebSocket, hostId: string, now: number): void {
    const { state, quiz } = this.requireRoom();
    this.attach(ws, { role: "host", hostId });
    const q = state.questionIndex;
    const question = q === null ? undefined : quiz.questions[q];
    const live = state.phase === "question" || state.phase === "grace";
    this.send(ws, {
      t: "host_welcome",
      v: PROTOCOL_VERSION,
      room: this.roomInfo(),
      phase: state.phase,
      players: this.hostRoster(),
      question: live && question && q !== null ? toPublicQuestion(question, q, quiz.questions.length) : null,
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
