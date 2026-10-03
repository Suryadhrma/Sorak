-- =============================================================
-- Sorak · seed lokal: "Kuis Demo Sorak" (10 soal)
--
-- Hanya untuk D1 lokal: pnpm --filter api db:seed:local
-- Cara pakai: login Google di lokal sekali (supaya ada baris hosts), lalu jalankan seed.
--
-- Idempoten:
--   1. kuis demo dibuat hanya untuk host yang belum punya kuis berjudul itu;
--   2. soal diisi hanya ke kuis demo yang belum punya soal.
--
-- UUID v4 dibuat di SQL supaya lolos z.uuid(): 8-4-4-4-12 hex, digit versi "4",
-- dan digit varian salah satu dari 8, 9, a, b.
-- =============================================================

INSERT INTO quizzes (id, host_id, title, description, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
    || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  h.id,
  'Kuis Demo Sorak',
  'Kuis contoh pengetahuan umum Indonesia untuk mencoba Sorak.',
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM hosts h
WHERE NOT EXISTS (
  SELECT 1 FROM quizzes q WHERE q.host_id = h.id AND q.title = 'Kuis Demo Sorak'
);

INSERT INTO questions
  (id, quiz_id, position, prompt, options, correct_index, time_limit_sec, explanation, origin, created_at, updated_at)
WITH demo (position, prompt, options, correct_index, time_limit_sec, explanation) AS (
  VALUES
    (0, 'Gunung tertinggi di Indonesia adalah...',
        '["Kerinci","Puncak Jaya","Rinjani","Semeru"]', 1, 20,
        'Puncak Jaya di Papua tingginya sekitar 4.884 meter.'),
    (1, 'Proklamasi kemerdekaan Indonesia dibacakan pada tanggal...',
        '["1 Juni 1945","28 Oktober 1928","17 Agustus 1945","20 Mei 1908"]', 2, 15,
        '1 Juni adalah Hari Lahir Pancasila, 28 Oktober Hari Sumpah Pemuda, dan 20 Mei Hari Kebangkitan Nasional.'),
    (2, 'Danau terbesar di Indonesia adalah...',
        '["Danau Singkarak","Danau Poso","Danau Toba"]', 2, 20,
        'Danau Toba di Sumatera Utara terbentuk dari letusan gunung api purba.'),
    (3, 'Komodo hidup secara alami di Pulau Jawa.',
        '["Benar","Salah"]', 1, 10,
        'Komodo hidup di Nusa Tenggara Timur, antara lain di Pulau Komodo, Rinca, dan Flores.'),
    (4, 'Pulau terbesar yang seluruh wilayahnya milik Indonesia adalah...',
        '["Kalimantan","Sumatera","Sulawesi","Jawa"]', 1, 25,
        'Kalimantan dan Papua lebih luas, tetapi sebagian wilayahnya milik negara lain.'),
    (5, 'Lagu kebangsaan Indonesia Raya diciptakan oleh...',
        '["W.R. Supratman","Ismail Marzuki","Kusbini"]', 0, 15, NULL),
    (6, 'Semboyan Bhinneka Tunggal Ika berasal dari kitab...',
        '["Negarakertagama","Sutasoma","Pararaton"]', 1, 20,
        'Kitab Sutasoma ditulis oleh Mpu Tantular pada masa Majapahit.'),
    (7, 'Candi Borobudur terletak di provinsi...',
        '["DI Yogyakarta","Jawa Timur","Jawa Tengah","Bali"]', 2, 20,
        'Borobudur berada di Kabupaten Magelang, Jawa Tengah.'),
    (8, 'Mata uang resmi Indonesia adalah Rupiah.',
        '["Benar","Salah"]', 0, 10, NULL),
    (9, 'Tari Kecak berasal dari daerah...',
        '["Aceh","Bali","Papua","Sumatera Barat"]', 1, 15, NULL)
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
    || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  q.id,
  demo.position,
  demo.prompt,
  demo.options,
  demo.correct_index,
  demo.time_limit_sec,
  demo.explanation,
  'manual',
  CAST(unixepoch('subsec') * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM quizzes q
CROSS JOIN demo
WHERE q.title = 'Kuis Demo Sorak'
  AND NOT EXISTS (SELECT 1 FROM questions x WHERE x.quiz_id = q.id);
