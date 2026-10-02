-- =============================================================
-- Sorak · D1 migration 0001_init
-- Skema awal database permanen (Cloudflare D1 / SQLite).
--
-- Konvensi:
--   * id           : TEXT UUID v4 dari crypto.randomUUID()
--   * waktu (*_at) : INTEGER milidetik Unix, sama dengan Date.now()
--   * boolean      : INTEGER 0/1
--   * kolom JSON   : TEXT yang divalidasi json_valid()
--   * nama kolom snake_case di SQL, camelCase di TypeScript
--
-- Jalankan dengan:
--   wrangler d1 migrations apply sorak-db --local
--   wrangler d1 migrations apply sorak-db --remote
-- =============================================================

-- -------------------------------------------------------------
-- hosts: akun guru / dosen / MC yang membuat dan menjalankan kuis
-- -------------------------------------------------------------
CREATE TABLE hosts (
  id               TEXT    PRIMARY KEY,
  email            TEXT    NOT NULL COLLATE NOCASE UNIQUE,
  display_name     TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  auth_provider    TEXT    NOT NULL DEFAULT 'password'
                           CHECK (auth_provider IN ('password', 'google', 'github')),
  password_hash    TEXT,               -- format PHC: pbkdf2-sha256$iter$salt$hash
  provider_subject TEXT,               -- ID akun dari Google/GitHub (OAuth)
  session_version  INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  -- akun password wajib punya hash; akun OAuth wajib punya provider_subject
  CHECK ((auth_provider = 'password') = (password_hash IS NOT NULL)),
  CHECK ((auth_provider = 'password') = (provider_subject IS NULL))
);

CREATE UNIQUE INDEX hosts_provider_subject_uq
  ON hosts (auth_provider, provider_subject)
  WHERE provider_subject IS NOT NULL;

-- -------------------------------------------------------------
-- quizzes: kumpulan soal milik satu host
-- -------------------------------------------------------------
CREATE TABLE quizzes (
  id          TEXT    PRIMARY KEY,
  host_id     TEXT    NOT NULL REFERENCES hosts (id) ON DELETE CASCADE,
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT    CHECK (description IS NULL OR length(description) <= 500),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- halaman "Kuis saya": WHERE host_id = ? ORDER BY updated_at DESC
CREATE INDEX quizzes_host_updated_idx ON quizzes (host_id, updated_at DESC);

-- -------------------------------------------------------------
-- questions: satu soal pilihan ganda (2 sampai 4 opsi)
-- -------------------------------------------------------------
CREATE TABLE questions (
  id             TEXT    PRIMARY KEY,
  quiz_id        TEXT    NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 0),
  prompt         TEXT    NOT NULL CHECK (length(prompt) BETWEEN 1 AND 300),
  options        TEXT    NOT NULL CHECK (
                   json_valid(options)
                   AND json_type(options) = 'array'
                   AND json_array_length(options) BETWEEN 2 AND 4
                 ),
  correct_index  INTEGER NOT NULL CHECK (
                   correct_index >= 0 AND correct_index < json_array_length(options)
                 ),
  time_limit_sec INTEGER NOT NULL DEFAULT 20 CHECK (time_limit_sec BETWEEN 5 AND 120),
  image_url      TEXT,
  explanation    TEXT    CHECK (explanation IS NULL OR length(explanation) <= 500),
  origin         TEXT    NOT NULL DEFAULT 'manual'
                         CHECK (origin IN ('manual', 'ai', 'ai_edited')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  -- satu posisi hanya untuk satu soal dalam kuis yang sama;
  -- indeks unik ini juga dipakai untuk WHERE quiz_id = ? ORDER BY position
  UNIQUE (quiz_id, position)
);

-- -------------------------------------------------------------
-- games: satu sesi kuis live yang sudah selesai (ditulis oleh consumer Queue)
-- -------------------------------------------------------------
CREATE TABLE games (
  id                   TEXT    PRIMARY KEY,          -- gameId dari GameRoom
  host_id              TEXT    NOT NULL REFERENCES hosts (id) ON DELETE CASCADE,
  quiz_id              TEXT    REFERENCES quizzes (id) ON DELETE SET NULL,
  quiz_title           TEXT    NOT NULL,             -- snapshot judul saat game dimainkan
  pin                  TEXT    NOT NULL CHECK (length(pin) = 6),
  scoring_mode         TEXT    NOT NULL CHECK (scoring_mode IN ('classic', 'accurate', 'confidence')),
  team_mode            INTEGER NOT NULL DEFAULT 0 CHECK (team_mode IN (0, 1)),
  player_count         INTEGER NOT NULL CHECK (player_count >= 0),
  question_count       INTEGER NOT NULL CHECK (question_count >= 0),
  misconception_report TEXT    CHECK (misconception_report IS NULL OR json_valid(misconception_report)),
  started_at           INTEGER NOT NULL,
  ended_at             INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  CHECK (ended_at >= started_at)
);

-- halaman riwayat: WHERE host_id = ? ORDER BY ended_at DESC
CREATE INDEX games_host_ended_idx ON games (host_id, ended_at DESC);
-- cron retensi 30 hari: WHERE ended_at < ?
CREATE INDEX games_ended_idx ON games (ended_at);

-- -------------------------------------------------------------
-- game_players: hasil akhir satu pemain (atau satu tim) dalam satu game
-- WITHOUT ROWID: baris disimpan langsung terurut menurut primary key,
-- sehingga tidak ada indeks tersembunyi tambahan -> 1 baris tulis per pemain.
-- -------------------------------------------------------------
CREATE TABLE game_players (
  game_id        TEXT    NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id      TEXT    NOT NULL,
  nickname       TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 20),
  team_size      INTEGER CHECK (team_size IS NULL OR team_size BETWEEN 1 AND 10),
  final_score    INTEGER NOT NULL CHECK (final_score >= 0),
  final_rank     INTEGER NOT NULL CHECK (final_rank >= 1),
  correct_count  INTEGER NOT NULL CHECK (correct_count >= 0),
  answered_count INTEGER NOT NULL CHECK (answered_count >= correct_count),
  highlights     TEXT    CHECK (highlights IS NULL OR json_valid(highlights)),  -- momen Rapor Sorak
  PRIMARY KEY (game_id, player_id)
) WITHOUT ROWID;

-- -------------------------------------------------------------
-- game_question_stats: statistik satu soal dalam satu game (Peta Miskonsepsi)
-- -------------------------------------------------------------
CREATE TABLE game_question_stats (
  game_id               TEXT    NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  position              INTEGER NOT NULL CHECK (position >= 0),
  question_id           TEXT,                        -- referensi lunak, tanpa FK
  prompt                TEXT    NOT NULL,            -- snapshot teks soal
  options               TEXT    NOT NULL CHECK (json_valid(options) AND json_type(options) = 'array'),
  correct_index         INTEGER NOT NULL CHECK (correct_index >= 0),
  answer_counts         TEXT    NOT NULL CHECK (json_valid(answer_counts) AND json_type(answer_counts) = 'array'),
  answered_count        INTEGER NOT NULL CHECK (answered_count >= 0),
  correct_count         INTEGER NOT NULL CHECK (correct_count BETWEEN 0 AND answered_count),
  avg_answer_ms         INTEGER CHECK (avg_answer_ms IS NULL OR avg_answer_ms >= 0),
  confident_wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (confident_wrong_count >= 0),
  PRIMARY KEY (game_id, position)
) WITHOUT ROWID;

-- -------------------------------------------------------------
-- ai_generations: log setiap permintaan generate soal ke Groq
-- dipakai untuk kuota harian per host dan metrik evaluasi AI
-- -------------------------------------------------------------
CREATE TABLE ai_generations (
  id              TEXT    PRIMARY KEY,
  host_id         TEXT    NOT NULL REFERENCES hosts (id) ON DELETE CASCADE,
  input_type      TEXT    NOT NULL CHECK (input_type IN ('text', 'image')),
  model           TEXT    NOT NULL,
  status          TEXT    NOT NULL
                          CHECK (status IN ('ok', 'invalid_schema', 'provider_error', 'quota_exceeded')),
  questions_count INTEGER NOT NULL DEFAULT 0 CHECK (questions_count >= 0),
  input_tokens    INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens   INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  latency_ms      INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at      INTEGER NOT NULL
);

-- kuota harian: WHERE host_id = ? AND created_at >= ?
CREATE INDEX ai_generations_host_created_idx ON ai_generations (host_id, created_at);
