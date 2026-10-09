import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  CloseCode,
  GameEndedEvent,
  HostServerMessage,
  InitRoomInput,
  InitRoomResult,
  JoinInfo,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTIONS_PER_QUIZ,
  NICKNAME_MAX_LENGTH,
  OPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  PROTOCOL_VERSION,
  PlayerAttachment,
  PlayerScore,
  PlayerServerMessage,
  QUEUE_MESSAGE_MAX_BYTES,
  QuizSnapshot,
  STALE_SOCKET_MS,
  SocketAttachment,
  decodeHostMessage,
  decodePlayerMessage,
  decodePlayerServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  isAllowedInPhase,
  nicknameKey,
  shouldReconnect,
  toPublicQuestion,
  type GameEndedEvent as GameEndedEventType,
  type ServerMessage,
  type StoredQuestion,
} from "../src/index.ts";

const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
const join = (extra: Record<string, unknown> = {}) => JSON.stringify({ t: "join", v: PROTOCOL_VERSION, nickname: "Dimas", ...extra });

describe("pesan pemain", () => {
  it("menerima join yang valid", () => {
    const result = decodePlayerMessage(join({ teamSize: 4 }));
    expect(result).toEqual({ ok: true, data: { t: "join", v: 1, nickname: "Dimas", teamSize: 4 } });
  });

  it("merapikan nickname: trim dan spasi beruntun", () => {
    const result = decodePlayerMessage(join({ nickname: "   Dimas    Ajah  " }));
    expect(result.ok && result.data.t === "join" && result.data.nickname).toBe("Dimas Ajah");
  });

  it.each([
    ["kosong", "   "],
    ["terlalu panjang", "a".repeat(NICKNAME_MAX_LENGTH + 1)],
    ["emoji", "Dimas🔥"],
    ["karakter tak terlihat (zero-width)", "Dim​as"],
    ["tanda kurung siku", "<b>Dimas</b>"],
  ])("menolak nickname %s", (_label, nickname) => {
    const result = decodePlayerMessage(join({ nickname }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("invalid_schema");
  });

  it("menerima nickname dengan huruf non-Latin", () => {
    expect(decodePlayerMessage(join({ nickname: "Rīna_02" })).ok).toBe(true);
  });

  it("menganggap nickname beda huruf besar sebagai kembar", () => {
    expect(nicknameKey("DIMAS  ajah")).toBe(nicknameKey("dimas Ajah"));
  });

  it("membedakan versi protokol lain dari pesan rusak", () => {
    expect(decodePlayerMessage(join({ v: 2 }))).toEqual({ ok: false, reason: "unsupported_version" });
    expect(decodeHostMessage(JSON.stringify({ t: "host_hello", v: 2 }))).toEqual({ ok: false, reason: "unsupported_version" });
  });

  it("pesan tanpa v atau tanpa t bukan masalah versi", () => {
    const noVersion = decodePlayerMessage(JSON.stringify({ t: "join", nickname: "Dimas" }));
    const noType = decodePlayerMessage(JSON.stringify({ v: 2 }));
    expect(!noVersion.ok && noVersion.reason).toBe("invalid_schema");
    expect(!noType.ok && noType.reason).toBe("invalid_schema");
  });

  it("menyebut path field yang gagal, supaya nickname salah bisa dibedakan dari pesan sampah", () => {
    const badNickname = decodePlayerMessage(join({ nickname: "Dimas🔥" }));
    const unknownType = decodePlayerMessage(JSON.stringify({ t: "give_me_points" }));
    expect(!badNickname.ok && badNickname.reason === "invalid_schema" && badNickname.issuePaths).toEqual(["nickname"]);
    expect(!unknownType.ok && unknownType.reason === "invalid_schema" && unknownType.issuePaths).toEqual(["t"]);
  });

  it("menolak field tambahan yang tidak dikenal (strict)", () => {
    const result = decodePlayerMessage(JSON.stringify({ t: "answer", q: 0, choice: 1, elapsedMs: 3000, score: 99999 }));
    expect(result.ok).toBe(false);
  });

  it("menerima jawaban valid, dengan dan tanpa tingkat yakin", () => {
    expect(decodePlayerMessage(JSON.stringify({ t: "answer", q: 3, choice: 2, elapsedMs: 4200 })).ok).toBe(true);
    expect(decodePlayerMessage(JSON.stringify({ t: "answer", q: 3, choice: 2, elapsedMs: 4200, confidence: 3 })).ok).toBe(true);
  });

  it.each([
    ["pilihan ke-5", { choice: 4 }],
    ["waktu negatif", { elapsedMs: -1 }],
    ["waktu pecahan", { elapsedMs: 10.5 }],
    ["waktu melebihi batas", { elapsedMs: 120_001 }],
    ["tingkat yakin 4", { confidence: 4 }],
    ["nomor soal negatif", { q: -1 }],
  ])("menolak jawaban dengan %s", (_label, patch) => {
    const message = { t: "answer", q: 0, choice: 0, elapsedMs: 1000, ...patch };
    expect(decodePlayerMessage(JSON.stringify(message)).ok).toBe(false);
  });

  it("menolak jenis pesan yang tidak dikenal", () => {
    expect(decodePlayerMessage(JSON.stringify({ t: "give_me_points" })).ok).toBe(false);
  });

  it("menolak pesan pemain yang dikirim sebagai pesan host", () => {
    expect(decodeHostMessage(JSON.stringify({ t: "answer", q: 0, choice: 0, elapsedMs: 1 })).ok).toBe(false);
  });
});

describe("pemeriksaan murah sebelum validasi", () => {
  it("menolak data biner", () => {
    expect(decodePlayerMessage(new ArrayBuffer(8))).toEqual({ ok: false, reason: "binary" });
  });

  it("menolak pesan lebih dari batas ukuran", () => {
    const huge = JSON.stringify({ t: "ack", q: 0, padding: "x".repeat(MAX_CLIENT_MESSAGE_BYTES) });
    expect(decodePlayerMessage(huge)).toEqual({ ok: false, reason: "too_large" });
  });

  it("menghitung byte UTF-8, bukan jumlah karakter", () => {
    // 1.500 karakter "é" = 3.000 byte, masih di bawah 4 KB; 1.500 karakter "語" = 4.500 byte.
    const latin = JSON.stringify({ t: "ack", q: 0, x: "é".repeat(1500) });
    const cjk = JSON.stringify({ t: "ack", q: 0, x: "語".repeat(1500) });
    expect(!decodePlayerMessage(latin).ok && (decodePlayerMessage(latin) as { reason: string }).reason).toBe("invalid_schema");
    expect(decodePlayerMessage(cjk)).toEqual({ ok: false, reason: "too_large" });
  });

  it("menolak JSON rusak", () => {
    expect(decodePlayerMessage("{t:ack")).toEqual({ ok: false, reason: "invalid_json" });
  });
});

describe("aturan tahap", () => {
  it.each([
    ["join", "lobby", true],
    ["join", "question", false],
    ["answer", "question", true],
    ["answer", "grace", true],
    ["answer", "reveal", false],
    ["answer", "lobby", false],
    ["start", "lobby", true],
    ["start", "question", false],
    ["next", "reveal", true],
    ["next", "question", false],
    ["resume", "ended", true],
  ] as const)("%s di tahap %s -> %s", (type, phase, allowed) => {
    expect(isAllowedInPhase(type, phase)).toBe(allowed);
  });
});

const storedQuestion: StoredQuestion = {
  questionId: "q-1",
  prompt: "Organel penghasil energi?",
  options: ["Nukleus", "Mitokondria", "Ribosom", "Lisosom"],
  correctIndex: 1,
  timeLimitSec: 20,
  imageUrl: null,
};

describe("keamanan soal", () => {
  it("soal untuk klien tidak pernah berisi kunci jawaban", () => {
    const publicQuestion = toPublicQuestion(storedQuestion, 0, 10);
    expect(publicQuestion).not.toHaveProperty("correctIndex");
    expect(encodeServerMessage({ t: "question", ...publicQuestion })).not.toContain("correctIndex");
  });

  it("menolak snapshot kuis yang kuncinya menunjuk opsi tidak ada", () => {
    const broken = { quizId: null, title: "Uji", questions: [{ ...storedQuestion, options: ["A", "B"], correctIndex: 3 }] };
    expect(QuizSnapshot.safeParse(broken).success).toBe(false);
  });
});

describe("pesan server sesuai skema", () => {
  const leader = { playerId: "p1", nickname: "Dimas", teamSize: null, score: 900, delta: 900, rank: 1 };
  const samples: ServerMessage[] = [
    {
      t: "welcome",
      v: 1,
      playerId: "p1",
      nickname: "Dimas",
      sessionToken: "AbCdEfGhIjKlMnOpQrStUv",
      room: { pin: "482913", scoringMode: "confidence", teamMode: false, questionCount: 10 },
      snapshot: { phase: "lobby", question: null, remainingMs: null, answered: false, score: 0, streak: 0, rank: null, playerCount: 12 },
    },
    { t: "lobby", playerCount: 13 },
    { t: "question", ...toPublicQuestion(storedQuestion, 0, 10) },
    { t: "answer_received", q: 0 },
    { t: "grace", q: 0, ms: 2000 },
    { t: "result", q: 0, outcome: "wrong", correctIndex: 1, points: -600, score: 0, rank: 7, streak: 0 },
    {
      t: "final",
      gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      score: 4200,
      rank: 3,
      playerCount: 36,
      highlights: { bestStreak: 4, confidentCorrect: 5, biggestRankClimb: 9, fastestCorrectMs: 2100 },
    },
    { t: "error", code: "NICKNAME_TAKEN", message: "Nickname sudah dipakai" },
  ];
  const hostSamples: ServerMessage[] = [
    {
      t: "host_welcome",
      v: 1,
      room: { pin: "482913", scoringMode: "classic", teamMode: true, questionCount: 10 },
      phase: "lobby",
      players: [{ playerId: "p1", nickname: "Tim Mawar", teamSize: 4, connected: true }],
      question: null,
      remainingMs: null,
      answered: 0,
    },
    { t: "player_joined", player: { playerId: "p2", nickname: "Andi", teamSize: null, connected: true }, playerCount: 2 },
    { t: "player_left", playerId: "p2", kicked: false, playerCount: 1 },
    { t: "answer_count", q: 0, answered: 27, total: 36 },
    { t: "reveal", q: 0, correctIndex: 1, counts: [3, 20, 11, 2], answered: 36, total: 36, leaderboard: [leader], isLastQuestion: false },
    { t: "podium", gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", top: [leader], playerCount: 36 },
    { t: "reaction", reaction: "fire" },
  ];

  it.each(samples.map((message) => [message.t, message] as const))("pesan pemain %s lolos skema", (_t, message) => {
    expect(PlayerServerMessage.safeParse(message).success).toBe(true);
    expect(decodePlayerServerMessage(encodeServerMessage(message)).ok).toBe(true);
  });

  it.each(hostSamples.map((message) => [message.t, message] as const))("pesan host %s lolos skema", (_t, message) => {
    expect(HostServerMessage.safeParse(message).success).toBe(true);
  });

  it("web versi lama mengabaikan field baru dari server (forward compatible)", () => {
    const result = decodePlayerServerMessage(JSON.stringify({ t: "lobby", playerCount: 3, newFeature: true }));
    expect(result.ok).toBe(true);
  });

  it("web mengabaikan jenis pesan yang belum dikenalnya tanpa crash", () => {
    expect(decodePlayerServerMessage(JSON.stringify({ t: "future_message" })).ok).toBe(false);
  });

  it("pesan klien bisa di-encode lalu di-decode kembali", () => {
    const answer = { t: "answer", q: 2, choice: 1, elapsedMs: 3000, confidence: 2 } as const;
    expect(decodePlayerMessage(encodeClientMessage(answer))).toEqual({ ok: true, data: answer });
  });
});

describe("anggaran ukuran (kasus terburuk)", () => {
  it(`attachment pemain muat di ${ATTACHMENT_MAX_BYTES} byte`, () => {
    const worst = PlayerAttachment.parse({
      role: "player",
      playerId: "x".repeat(40),
      nickname: "語".repeat(NICKNAME_MAX_LENGTH),
      tokenHash: "f".repeat(64),
      teamSize: 10,
      joinedAt: Date.now(),
      latencyMs: 1500,
      ackedQ: 49,
      score: 999_999,
      streak: 49,
      answer: { q: 49, choice: 3, tMs: 120_000, confidence: 3 },
    });
    const size = bytes(worst);
    console.info(`attachment terburuk: ${size} byte`);
    expect(size).toBeLessThan(ATTACHMENT_MAX_BYTES / 2);
  });

  it("pesan soal tanpa gambar di bawah 2 KB untuk teks Latin terpanjang", () => {
    const longest: StoredQuestion = {
      ...storedQuestion,
      prompt: "a".repeat(PROMPT_MAX_LENGTH),
      options: Array.from({ length: 4 }, () => "b".repeat(OPTION_MAX_LENGTH)),
    };
    const size = bytes(encodeServerMessage({ t: "question", ...toPublicQuestion(longest, 49, 50) }));
    console.info(`pesan soal terpanjang: ${size} byte`);
    expect(size).toBeLessThan(2048);
  });

  it(`event game_ended terbesar muat di batas Queue ${QUEUE_MESSAGE_MAX_BYTES / 1024} KB`, () => {
    const event: GameEndedEventType = {
      type: "game_ended",
      v: 1,
      gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      hostId: crypto.randomUUID(),
      quizId: crypto.randomUUID(),
      quizTitle: "t".repeat(120),
      pin: "482913",
      scoringMode: "confidence",
      teamMode: true,
      startedAt: 1_790_000_000_000,
      endedAt: 1_790_000_900_000,
      players: Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, i) => ({
        playerId: crypto.randomUUID(),
        nickname: "n".repeat(NICKNAME_MAX_LENGTH),
        teamSize: 10,
        finalScore: 999_999,
        finalRank: i + 1,
        correctCount: 50,
        answeredCount: 50,
        highlights: { bestStreak: 50, confidentCorrect: 50, biggestRankClimb: 199, fastestCorrectMs: 119_999 },
      })),
      questions: Array.from({ length: MAX_QUESTIONS_PER_QUIZ }, (_, i) => ({
        position: i,
        questionId: crypto.randomUUID(),
        prompt: "p".repeat(PROMPT_MAX_LENGTH),
        options: Array.from({ length: 4 }, () => "o".repeat(OPTION_MAX_LENGTH)),
        correctIndex: 3,
        answerCounts: [50, 50, 50, 50],
        answeredCount: 200,
        correctCount: 50,
        avgAnswerMs: 60_000,
        confidentWrongCount: 150,
      })),
    };
    expect(GameEndedEvent.safeParse(event).success).toBe(true);
    const size = bytes(event);
    console.info(`event game_ended terbesar: ${(size / 1024).toFixed(1)} KB`);
    expect(size).toBeLessThan(QUEUE_MESSAGE_MAX_BYTES);
  });
});

describe("attachment socket pending", () => {
  it("menerima kedua bentuk pending", () => {
    expect(SocketAttachment.safeParse({ role: "pending_player", connectedAt: 1 }).success).toBe(true);
    expect(SocketAttachment.safeParse({ role: "pending_host", hostId: "h1", connectedAt: 1 }).success).toBe(true);
  });

  it("socket yang digantikan atau di-kick ditandai replaced", () => {
    expect(SocketAttachment.safeParse({ role: "replaced" }).success).toBe(true);
  });

  it("pending host tanpa hostId dan bentuk lama 'pending' ditolak", () => {
    expect(SocketAttachment.safeParse({ role: "pending_host", connectedAt: 1 }).success).toBe(false);
    expect(SocketAttachment.safeParse({ role: "pending", connectedAt: 1 }).success).toBe(false);
  });
});

describe("kontrol room (Worker ke GameRoom)", () => {
  const input = {
    gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    hostId: "h1",
    pin: "004213",
    scoringMode: "classic",
    teamMode: false,
    quiz: { quizId: "q1", title: "Kuis", questions: [storedQuestion] },
  };

  it("menerima input init yang valid, termasuk PIN berawalan nol", () => {
    expect(InitRoomInput.safeParse(input).success).toBe(true);
  });

  it.each([
    ["PIN 5 digit", { pin: "12345" }],
    ["gameId bukan UUID", { gameId: "game-1" }],
    ["kuis tanpa soal", { quiz: { quizId: null, title: "Kosong", questions: [] } }],
  ])("menolak input init dengan %s", (_label, patch) => {
    expect(InitRoomInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });

  it("hasil init: sukses atau PIN sudah dipakai, alasan lain ditolak", () => {
    expect(InitRoomResult.safeParse({ ok: true }).success).toBe(true);
    expect(InitRoomResult.safeParse({ ok: false, reason: "pin_in_use" }).success).toBe(true);
    expect(InitRoomResult.safeParse({ ok: false, reason: "busy" }).success).toBe(false);
  });

  it("join info menerima field baru dari versi GameRoom yang lebih baru (version skew)", () => {
    expect(JoinInfo.safeParse({ status: "open", playerCount: 3, newField: 1 }).success).toBe(true);
    expect(JoinInfo.safeParse({ status: "closed", playerCount: 3 }).success).toBe(false);
    expect(JoinInfo.safeParse({ status: "full", playerCount: MAX_PLAYERS_PER_ROOM + 1 }).success).toBe(false);
  });
});

describe("skor pemain di storage", () => {
  const score = {
    score: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    answered: 1,
    confidentCorrect: 0,
    fastestCorrectMs: null,
    worstRank: 1,
    biggestRankClimb: 0,
    lastPoints: 0,
    lastOutcome: "no_answer" as const,
  };

  it("hasil soal terakhir: tiga kemungkinan, atau null sebelum reveal pertama", () => {
    expect(PlayerScore.safeParse({ ...score, lastOutcome: null }).success).toBe(true);
    expect(PlayerScore.safeParse({ ...score, lastOutcome: "correct" }).success).toBe(true);
    expect(PlayerScore.safeParse({ ...score, lastOutcome: "late" }).success).toBe(false);
  });

  it("poin per soal boleh negatif (Taruhan Yakin), skor total tidak", () => {
    expect(PlayerScore.safeParse({ ...score, lastPoints: -1800 }).success).toBe(true);
    expect(PlayerScore.safeParse({ ...score, score: -1 }).success).toBe(false);
  });
});

describe("batas socket basi", () => {
  it("memberi toleransi satu ping hilang: dua interval ditambah timeout", () => {
    expect(STALE_SOCKET_MS).toBe(35_000);
  });
});

describe("close code", () => {
  it.each([
    [CloseCode.NORMAL, false],
    [CloseCode.GOING_AWAY, true],
    [CloseCode.ABNORMAL, true],
    [CloseCode.INTERNAL_ERROR, true],
    [CloseCode.RATE_LIMITED, true],
    [CloseCode.KICKED, false],
    [CloseCode.REPLACED, false],
    [CloseCode.SESSION_INVALID, false],
    [CloseCode.ROOM_CLOSED, false],
  ])("kode %i -> reconnect: %s", (code, expected) => {
    expect(shouldReconnect(code)).toBe(expected);
  });
});
