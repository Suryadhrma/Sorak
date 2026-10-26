# Spec Hari 5: hasil tersimpan, dan tampilan sesuai desain

- Tanggal: 2026-10-12
- Hari ini dibagi dua bagian. Kerjakan berurutan, dan mulai sesi Claude Code baru (`/clear`) di antara keduanya.
  - **Bagian A, data.** Setelah game selesai, hasilnya tersimpan otomatis ke D1 lewat Queue. Guru bisa membuka riwayat dan laporan dasar (skor pemain, persen benar per soal). Hasil yang berumur lebih dari 30 hari dihapus cron.
  - **Bagian B, tampilan.** Semua layar HP, proyektor, dan guru mengikuti board desain "Papan skor kelas", lengkap dengan geraknya. Tombol Sorak di lobby dikerjakan terakhir, hanya kalau waktunya masih ada.
- Dokumen acuan:
  - CLAUDE.md dan semua file di `.claude/rules/`;
  - `packages/shared/src`, terutama `events.ts` (`GameEndedEvent`);
  - System Design bagian 9 (pekerjaan setelah game);
  - Data Model D1 bagian 5.4–5.6 dan 7 (tabel hasil dan anggaran tulis);
  - `apps/api/migrations/0001_init.sql`;
  - board desain di `docs/design/boards/` (baca `README.md` di sana).
- **Kode Hari 1–4 adalah acuan utama.** Kalau nama di spec ini berbeda dengan kode, ikuti kode dan sebutkan di rencana.

## Bagian A. Hasil game tersimpan

### A1. Sumber daya Cloudflare (dibuat Surya, bukan Claude Code)

Queues sudah tersedia di Workers Free sejak Februari 2026. Batasnya: 10.000 operasi per hari, dan pesan bertahan paling lama 24 jam.

Surya menjalankan sendiri, sekali saja:

```bash
pnpm exec wrangler queues create sorak-game-events
pnpm exec wrangler queues create sorak-game-events-dlq
```

- `sorak-game-events-dlq` adalah **dead letter queue (DLQ)**: tempat pesan yang tetap gagal setelah semua percobaan ulang, supaya tidak hilang diam-diam.
- Karena retensi di plan Free hanya 24 jam, pesan di DLQ harus diperiksa dalam sehari. Itu cukup untuk proyek portofolio. Catat sebagai keterbatasan di ADR.

Claude Code hanya menulis konfigurasinya di `wrangler.jsonc`, dan tidak menjalankan perintah `wrangler` apa pun.

### A2. Perubahan di `packages/shared`

**Konstanta:**

| Nama | Nilai | Arti |
|---|---|---|
| `GAME_RESULT_RETENTION_DAYS` | 30 | Umur maksimal hasil game di D1 |
| `GAME_EVENT_RETRY_MS` | `[30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000]` | Jeda GameRoom mencoba ulang kirim event kalau Queue gagal; berhenti di elemen terakhir |
| `GAME_EVENT_GIVE_UP_MS` | 86.400.000 (24 jam) | Batas GameRoom berhenti mencoba dan mencatat event hilang |
| `GAMES_PAGE_SIZE` | 20 | Jumlah game per halaman riwayat |

**`RoomState`** bertambah dua field:
- `gameEventSentAt: Timestamp.nullable()`: kapan event berhasil dikirim;
- `gameEventAttempts: z.number().int().min(0)`: jumlah percobaan kirim yang gagal, untuk memilih jeda di `GAME_EVENT_RETRY_MS`.

**REST** (skema respons di shared, dipakai Worker dan web):
- `GameSummary`: `id`, `quizTitle`, `pin`, `scoringMode`, `playerCount`, `questionCount`, `startedAt`, `endedAt`.
- `GameListResponse`: `{ games: GameSummary[], nextCursor: string | null }`.
- `GameDetail`: `GameSummary` ditambah:
  - `players`: `nickname`, `finalScore`, `finalRank`, `correctCount`, `answeredCount`;
  - `questions`: `position`, `prompt`, `options`, `correctIndex`, `answerCounts`, `answeredCount`, `correctCount`, `avgAnswerMs`.
  - `playerId` dan `highlights` tidak dikirim ke halaman guru, karena belum dipakai di sana.

### A3. GameRoom mengirim `game_ended`

**`apps/realtime/src/game-event.ts`** berisi satu fungsi murni, `buildGameEndedEvent({ state, quiz, roster, scoreboard, qstats })`, yang mengembalikan `GameEndedEvent`:

- `players`: semua pemain di roster (yang sudah di-kick tidak ikut).
  - `finalRank` memakai fungsi peringkat yang sama dengan reveal.
  - `highlights` diambil dari `PlayerScore`.
- `questions`: **hanya soal yang sudah di-reveal**, yaitu sepanjang `qstats`.
  - `avgAnswerMs` = rata-rata waktu jawaban **benar** (`totalCorrectMs / correct`, dibulatkan), atau null kalau tidak ada yang benar. Beri komentar soal makna ini, karena nama kolomnya bisa disangka rata-rata semua jawaban.
- `quizId` dan `quizTitle` dari `quiz`; `hostId`, `pin`, `scoringMode`, `teamMode`, `startedAt`, `endedAt` dari `state`.

**Kapan dikirim:**
- Saat masuk tahap `ended` dari game yang sudah berjalan (setelah `next` di soal terakhir, `end` dari host, atau idle timeout).
- **Tidak dikirim** kalau room dibatalkan di lobby, atau kalau belum ada satu soal pun yang di-reveal (contohnya `end` di tengah soal pertama). Tidak ada hasil yang layak disimpan.

**Urutan di handler `ended`:**
1. Bangun event, lalu validasi dengan `GameEndedEvent.parse`. Kalau gagal, berarti bug: catat di log `game_event_invalid` beserta `gameId`, dan jangan kirim.
2. `await env.GAME_EVENTS.send(event)`.
3. Satu `put` `state` (phase `ended`, `endedAt`, dan `gameEventSentAt = now` kalau kirim berhasil), lalu `setAlarm`, seperti Hari 3.
4. Kalau kirim gagal (melempar):
   - `gameEventSentAt` tetap null;
   - alarm dipasang ke `now + GAME_EVENT_RETRY_MS[0]`, bukan ke akhir retensi.
   - Pesan `podium` dan `final` tetap dikirim. Siswa tidak perlu menunggu Queue.

**Alarm di tahap `ended`:**
- `gameEventSentAt` null, event memang perlu dikirim, dan belum lewat `GAME_EVENT_GIVE_UP_MS` sejak `endedAt` → coba kirim lagi.
  - Berhasil: `put` state, lalu alarm ke `endedAt + ENDED_RETENTION_MS`. Kalau waktu itu sudah lewat, langsung tutup room.
  - Gagal: alarm ke jeda berikutnya. Nomor percobaan disimpan di `state`, sebagai bagian dari `put` yang sama.
- Sudah lewat `GAME_EVENT_GIVE_UP_MS` → catat `game_event_lost` (dengan `gameId`, `hostId`, jumlah pemain), lalu bersihkan room seperti biasa.
- Selain itu → bersihkan room seperti Hari 3.

Polanya disebut **retry with backoff**: jeda percobaan makin panjang supaya Queue yang sedang bermasalah tidak dibanjiri. Biaya tulis di jalur normal tetap sama seperti Hari 3, karena `gameEventSentAt` ikut di `put` yang memang sudah ada.

**Binding** di `apps/realtime/wrangler.jsonc`: `queues.producers: [{ binding: "GAME_EVENTS", queue: "sorak-game-events" }]`.

**Test:**
- `buildGameEndedEvent`:
  - 3 pemain dengan satu yang di-kick;
  - game yang diakhiri setelah 2 dari 5 soal (questions berisi 2);
  - `avgAnswerMs` null kalau tidak ada yang benar;
  - ukuran JSON kasus terburuk (200 pemain, 50 soal, semua teks maksimal) di bawah `QUEUE_MESSAGE_MAX_BYTES` dikurangi 100 byte metadata.
- GameRoom:
  - game 3 soal selesai → producer menerima tepat satu event yang lolos skema;
  - batal di lobby → tidak ada event;
  - `send` melempar → podium tetap terkirim, alarm retry terpasang, lalu alarm berikutnya mengirim ulang dan berhasil;
  - lewat `GAME_EVENT_GIVE_UP_MS` → log `game_event_lost`, storage bersih.

### A4. Consumer di Worker `sorak` (`apps/api`)

**Konfigurasi** `apps/api/wrangler.jsonc`:

```jsonc
"queues": {
  "consumers": [{
    "queue": "sorak-game-events",
    "max_batch_size": 1,
    "max_retries": 5,
    "retry_delay": 60,
    "dead_letter_queue": "sorak-game-events-dlq"
  }]
}
```

**Kenapa `max_batch_size: 1`:**
- D1 di plan Free membatasi 50 query per pemanggilan Worker, dan 100 parameter per query (sudah dicek di dokumentasi D1, Oktober 2026).
- Satu event menghasilkan sekitar 27 query (perhitungannya di bawah). Dua event dalam satu batch sudah melewati 50.
- Konsekuensinya: satu pemanggilan per game. Jumlah game per hari kecil, jadi tidak masalah.

**Handler `queue(batch, env)`** untuk setiap pesan:

1. Validasi dengan `GameEndedEvent.safeParse`.
   - Gagal → log `game_event_invalid` (sertakan `gameId` kalau terbaca), lalu `message.ack()`.
   - Pesan rusak tidak akan sembuh kalau dicoba ulang. Ini disebut **poison message**: pesan yang selalu gagal dan hanya membuang percobaan.
2. Cek host masih ada: `SELECT 1 FROM hosts WHERE id = ?`.
   - Tidak ada (akun sudah dihapus) → log `game_event_host_missing`, lalu `ack()`.
   - Alasannya: insert ke `games` akan gagal karena foreign key, dan percobaan ulang tidak mengubah apa pun.
3. Susun satu `db.batch()` (satu transaksi, jadi masuk semua atau tidak sama sekali):
   - `INSERT OR IGNORE INTO games ...`, dengan `quiz_id` memakai subquery `(SELECT id FROM quizzes WHERE id = ?)`. Kalau kuisnya sudah dihapus, hasilnya NULL dan foreign key tidak gagal. Riwayat tetap tersimpan, sesuai `ON DELETE SET NULL` di Data Model.
   - `INSERT OR IGNORE INTO game_players` dengan **banyak baris per statement**. Satu statement maksimal `floor(100 / jumlah kolom)` baris, supaya parameternya di bawah 100. Fungsi pemecahnya murni dan diuji.
   - `INSERT OR IGNORE INTO game_question_stats` dengan cara yang sama.
4. Berhasil → jumlahkan `meta.rows_written` semua statement, catat di log `game_event_saved` (dengan `gameId` dan `rowsWritten`), lalu `ack()`. Bandingkan angka ini dengan anggaran di Data Model bagian 7, dan laporkan.
5. Error D1 → log `game_event_save_failed`, lalu `message.retry({ delaySeconds: 60 × 2^(attempts − 1) })`. Setelah `max_retries`, Queue memindahkan pesan ke DLQ.

**Idempotent:** semua insert memakai `INSERT OR IGNORE` dengan primary key yang berasal dari event (`gameId`, `gameId + playerId`, `gameId + position`). Pesan yang sama datang dua kali tetap menghasilkan data yang sama. Queue menjamin pengiriman **at-least-once**, artinya minimal sekali dan bisa lebih.

**Hitungan query per event** (200 pemain, 50 soal):
- 1 cek host;
- 1 insert `games`;
- `game_players`: 9 kolom → 11 baris per statement → 19 statement;
- `game_question_stats`: 11 kolom → 9 baris per statement → 6 statement;
- total 27, di bawah 50.

Sesuaikan hitungannya dengan jumlah kolom sebenarnya di `0001_init.sql`, dan tulis test yang memastikan event terbesar tetap di bawah 50 query.

**Test** (vitest-pool-workers, D1 lokal):
- event valid → 1 baris `games`, N baris `game_players`, M baris `game_question_stats`;
- pesan yang sama dua kali → jumlah baris tetap;
- kuis sudah dihapus → `quiz_id` NULL, data lain tersimpan;
- host tidak ada → ack tanpa insert;
- skema rusak → ack tanpa insert;
- D1 gagal (simulasikan) → `retry` dipanggil dengan jeda yang benar;
- event 200 pemain dan 50 soal → jumlah statement ≤ 50, dan setiap statement ≤ 100 parameter.

### A5. Cron hapus hasil lama

`apps/api/wrangler.jsonc`: `"triggers": { "crons": ["17 19 * * *"] }`, yaitu setiap hari pukul 02.17 WIB, saat kelas tidak berjalan.

Handler `scheduled()`:
- `cutoff = now − GAME_RESULT_RETENTION_DAYS hari`.
- Hapus bertahap: `DELETE FROM games WHERE id IN (SELECT id FROM games WHERE ended_at < ? LIMIT 25)`, diulang sampai tidak ada baris terhapus, maksimal 40 kali per pemanggilan (tetap di bawah 50 query).
- `game_players` dan `game_question_stats` ikut terhapus lewat `ON DELETE CASCADE`. Test harus membuktikan foreign key memang aktif di D1.
- Log `retention_cleanup` dengan jumlah game terhapus dan total `rows_written`. Kalau masih ada sisa setelah 40 putaran, catat `retention_backlog`; cron besok melanjutkan.

**Test:** game berumur 31 hari terhapus beserta anaknya, game berumur 29 hari tetap ada, dan handler dipanggil dengan `createScheduledController`.

### A6. REST riwayat (`requireHost`)

**`GET /api/games?cursor=`**
- Game milik host yang login, terbaru dulu, `GAMES_PAGE_SIZE` per halaman.
- Pakai **keyset pagination**: cursor berisi `endedAt` dan `id` game terakhir di halaman sebelumnya. Halaman berikutnya mengambil `WHERE host_id = ? AND (ended_at, id) < (?, ?)`.
  - Kenapa tidak `OFFSET`: OFFSET membuat D1 tetap membaca semua baris yang dilewati. Baris yang dibaca dihitung kuota, dan halaman ke-10 jadi 10 kali lebih mahal.
  - Keyset langsung melompat lewat indeks `games_host_ended_idx`.
- Cursor di-encode base64url. Cursor rusak → 400.

**`GET /api/games/:id`**
- Game, pemain (urut `final_rank`, lalu `nickname`), dan statistik soal (urut `position`).
- Game milik host lain atau tidak ada → 404 yang sama. Jangan beri tahu bahwa game-nya ada.
- Kolom JSON (`options`, `answer_counts`) di-parse lalu divalidasi Zod saat dibaca.

**Test:** urutan dan halaman (25 game → 20 + 5, cursor kedua null), cursor rusak, game milik host lain → 404, dan `EXPLAIN QUERY PLAN` daftar game memakai indeks (SEARCH, bukan SCAN).

### A7. Web: riwayat dan laporan

Gaya halaman guru: kertas bergaris buku (board Guru-2).

**`/games` (Riwayat):**
- Baris per game: judul kuis, tanggal dan jam selesai, jumlah pemain, jumlah soal, dan mode.
- Tombol "Muat lebih banyak" kalau `nextCursor` ada.
- Keadaan kosong: "Belum ada game yang selesai. Hasil game muncul di sini setelah kamu menekan Selesai di podium."
- Tautan "Riwayat" di header halaman guru.

**`/games/:id` (Laporan):**
- Kepala: judul, tanggal, mode, jumlah pemain.
- **Skor pemain:** tabel peringkat, nama, skor, dan "benar X dari Y".
- **Per soal:** teks soal, persen benar (`correctCount / answeredCount`, atau "Tidak ada yang menjawab"), sebaran A–D dengan ubin huruf, dan pilihan benar diberi cincin "benar".
  - **Pengecoh terpopuler:** pilihan salah dengan pemilih terbanyak. Tampilkan hanya kalau dipilih minimal 20% yang menjawab, misalnya "C dipilih 11 siswa". Ini bahan awal Peta Miskonsepsi.
- Soal dengan persen benar di bawah 50% ditandai "Perlu dibahas ulang".

**Dari podium:** tombol "Lihat rapor kelas" membuka `/games/:gameId` (`gameId` ada di pesan `podium`).
- Consumer butuh beberapa detik.
- Kalau responsnya 404 dalam 60 detik pertama setelah game selesai, tampilkan "Laporan sedang disimpan…", lalu coba lagi otomatis 3 kali dengan jeda 2 detik. Setelah itu tampilkan tombol "Coba lagi".

Test: reducer atau fungsi murni untuk persen benar, pengecoh terpopuler, dan penanda "Perlu dibahas ulang".

### A8. Uji manual Bagian A

1. `pnpm dev`. Queue lokal disimulasikan wrangler, dan `wrangler dev` untuk dua Worker sudah mendukung producer dan consumer.
2. Mainkan Kuis Demo 3 soal sampai podium. Tekan "Lihat rapor kelas", lalu cocokkan skor dan persen benar dengan yang terlihat selama game.
3. Mainkan lagi, lalu tekan "Akhiri game" setelah soal 2. Laporan berisi 2 soal.
4. Batalkan satu room di lobby. Tidak ada baris baru di riwayat.
5. Jalankan cron secara manual (endpoint `/__scheduled` dari `wrangler dev --test-scheduled`), setelah mengubah `ended_at` satu game uji menjadi 31 hari lalu lewat `wrangler d1 execute --local`.
6. Catat `rowsWritten` per game dari log, lalu bandingkan dengan Data Model bagian 7.

## Bagian B. Tampilan dan gerak sesuai desain

### B1. Acuan

- Board ada di `docs/design/boards/*.html`. Buka di browser, dan baca `README.md` di folder itu untuk pemetaan board ke halaman.
- Token warna, font, radius, dan gerak sudah ada di `styles.css` sejak koreksi desain. **Jangan menambah nilai warna atau ukuran di komponen.** Kalau butuh nilai baru, tambahkan sebagai token.
- Board adalah acuan visual, bukan kode untuk disalin. Struktur tetap komponen React dan aturan aksesibilitas di `.claude/rules/web.md`.

### B2. Komponen gerak

Dibuat sekali, dipakai di banyak layar:

| Komponen | Isi | Gerak |
|---|---|---|
| `FlapDigits` | Deretan ubin angka dengan garis belah di tengah | Setiap digit yang berubah berputar masuk (`rotateX`), 500 ms, jeda 60 ms per digit |
| `Tally` | Turus SVG dari angka `n` (4 garis tegak + 1 miring per ikat) | Garis baru digambar (`stroke-dashoffset`) 300 ms. Hanya garis yang **bertambah** yang digambar, bukan semua dari awal |
| `Countdown` | Angka besar dan batang waktu | Angka berganti per detik dengan gulung pendek. Batang memakai `scaleX`. Warna `waktu-kritis` di 5 detik terakhir |
| `RaiseIn` | Pembungkus kartu jawaban | Berputar dari tepi atas, 450 ms, jeda 70 ms per kartu |
| `Leaderboard` | Papan skor 10 besar | **FLIP** (dijelaskan di bawah), 600 ms, baris yang naik diberi bingkai `kapur` |
| `RiseIn` | Batang sebaran jawaban dan balok podium | `scaleX` / `translateY`, 700 ms. Juara 1 muncul paling akhir |
| `Logo` (sudah ada) | Ditambah prop `animate` | Tangan terangkat dan garis sorak, 900 ms, sekali |

**Aturan gerak:**
- Animasi masuk diputar **sekali** saat layar atau nilai berubah, tidak berulang seperti di board.
- Hanya animasikan `transform` dan `opacity`. Keduanya dikerjakan GPU (compositor) tanpa menghitung ulang tata letak, jadi tetap lancar di Android RAM 2 GB.
  - Jangan menganimasikan `width`, `height`, `top`, atau `box-shadow`.
  - Batang sebaran memakai `scaleX`, bukan `width`.
- `prefers-reduced-motion: reduce` → semua animasi mati, dan layar langsung di keadaan akhir. Untuk FLIP dan hitungan berbasis JS, cek `matchMedia`.
- **Tidak ada library animasi** (framer-motion dan sejenisnya), karena dependensi baru dan bundle siswa wajib di bawah 200 KB gzip. Cukup CSS keyframes, transition, dan Web Animations API (`element.animate`) untuk FLIP.

**FLIP** (First, Last, Invert, Play) untuk papan skor:
1. **First:** catat posisi setiap baris sebelum urutan berubah.
2. **Last:** biarkan React merender urutan baru, lalu ukur posisi barunya di `useLayoutEffect`.
3. **Invert:** geser setiap baris kembali ke posisi lamanya dengan `transform`.
4. **Play:** animasikan transform ke nol.

Hasilnya, baris terlihat meluncur ke tempat barunya, padahal yang dianimasikan hanya `transform`. Data posisi lama didapat dari leaderboard `reveal` sebelumnya yang disimpan reducer host. Pemain yang sebelumnya di luar 10 besar masuk dari bawah.

### B3. Layar dan datanya

Setiap layar memakai data yang sudah ada di protokol. Kalau board menampilkan sesuatu yang datanya tidak ada, ikuti kolom "Penyesuaian", jangan menambah pesan baru.

| Board | Layar | Penyesuaian terhadap board |
|---|---|---|
| HP-1 | `/` | Keypad angka di layar (tombol 0–9, Hapus, Masuk), supaya keyboard HP tidak mendorong tata letak. Tetap terima ketikan keyboard fisik di laptop. Tombol keypad punya `aria-label` |
| HP-2 | form nama | Hitungan "N teman sudah di sini" hanya kalau `RoomLookup` sudah memuat jumlah pemain; kalau tidak, hilangkan baris itu |
| HP-3 | lobby | Tombol Sorak dikerjakan di B5. Tanpa B5, lobby tampil tanpa tombol itu |
| HP-4 | question | Sesuai board. "Kombo N" dari `streak` |
| HP-5 | terkirim | **Hilangkan "18 / 27 sudah menjawab".** Pemain tidak menerima `answer_count`, dan menambahkannya berarti setiap jawaban dikirim ke 200 HP (sekitar 40.000 pesan per soal). Ganti dengan turus menunggu dan teks "Hasil muncul saat waktu habis atau semua sudah menjawab" |
| HP-6 | result benar | "Kombo N" tanpa angka bonus, karena rumus bonus ada di server. "Naik X tingkat" dari peringkat result sebelumnya yang disimpan reducer; tampil hanya kalau naik |
| HP-7 | result salah / tidak menjawab | **Hilangkan blok penjelasan guru**: soal belum punya `explanation` di protokol (lihat B6). Untuk "Tidak menjawab", tampilkan jawaban benar tanpa baris "Jawabanmu" |
| HP-8 | final | Rapor berisi baris yang datanya ada: kombo terpanjang, jawaban benar tercepat, naik peringkat terbanyak. Baris "benar X dari Y" ditambahkan lewat perubahan protokol kecil di B4 |
| HP-9 | terputus | Sudah dari Hari 4; samakan tampilannya dengan board |
| Proyektor-1 | lobby host | Alamat situs dari `location.host`, bukan teks tetap. Aliran sorak dan saklarnya ada di B5 |
| Proyektor-2 | question | Sesuai board. "18 dari 27 sudah menjawab" dari `answer_count`, ditambah "N terputus" dari Hari 4 |
| Proyektor-3 | reveal, sebaran | **Hilangkan kotak penjelasan dan "paling cepat benar"**, karena datanya tidak ada |
| Proyektor-4 | reveal, papan skor | Kolom kanan memakai yang bisa dihitung host: "Naik paling jauh" (dari leaderboard sebelumnya), "Poin terbesar soal ini" (delta tertinggi), dan "X dari Y benar di soal ini". Hilangkan "Kombo terpanjang" |
| Proyektor-5 | podium | Konfeti turus hanya CSS (sekitar 30 elemen), dan hanya di layar proyektor. Tombol "Lihat rapor kelas" ke laporan Bagian A |
| Guru-1 | `/login` | Sesuai board; tombol Google tanpa logo Google |
| Guru-2 | `/quizzes` | Meta baris: jumlah soal dan tanggal diubah. "Terakhir dimainkan" belum ada datanya; jangan ditambah hari ini |
| Guru-3 | editor | Restyle saja. Field penjelasan hanya kalau editor sudah memilikinya |
| Guru-4 | dialog mode | Restyle dialog Hari 3 |

Halaman Riwayat dan Laporan dari Bagian A memakai gaya yang sama dengan Guru-2.

### B4. Perubahan protokol kecil: `final`

- `FinalMessage` bertambah `correctCount` dan `questionCount`, keduanya **opsional** di skema. Server mengisinya dari `PlayerScore.correct` dan jumlah soal yang di-reveal.
- Opsional karena web dan GameRoom di-deploy terpisah. Web baru yang menerima `final` dari GameRoom lama tetap jalan: baris "benar X dari Y" cukup disembunyikan. Ini perubahan **kompatibel**, jadi `PROTOCOL_VERSION` tidak naik.
- Sesuai aturan nomor 6 di CLAUDE.md: skema, test, dan catatan untuk dokumen Protokol ikut berubah.

### B5. Tombol Sorak (terakhir, hanya kalau B1–B4 selesai)

Kalau waktunya habis, berhenti di B4. Tombol Sorak tetap di task Hari 9 di Notion. Jangan dikerjakan setengah.

**Protokol:**
- `REACTIONS` bertambah `"sorak"`. Perubahan ini kompatibel karena hanya menambah nilai yang diterima server. Deploy GameRoom lebih dulu.
- Pesan server baru ke host: `cheer { total, recent: Nickname[] (maks 5) }`.
- Pesan server baru ke pemain: `cheer_total { total }`.
- Pesan `reaction` lama dihapus dari skema kalau belum dipakai di mana pun. Cek dulu.

**Server:**
- `react` di luar lobby diabaikan untuk saat ini. UI-nya memang hanya ada di lobby.
- **Bucket kedua khusus sorak**, per socket di memori: kapasitas 5, isi ulang 2 per detik.
  - Kelebihannya **dibuang diam-diam**, tanpa menutup socket. Token bucket umum (10 pesan per detik) tetap berlaku, tapi HP tidak akan menyentuhnya karena klien sendiri dibatasi.
- `total` dan daftar `recent` disimpan di memori GameRoom saja. Kalau objek hibernasi, total kembali 0. Ini dekorasi, tidak layak memakan kuota tulis storage.
- **Throttle tanpa timer** (GameRoom tidak boleh memakai `setTimeout`):
  - kirim `cheer` ke host kalau sudah lewat 300 ms sejak kiriman terakhir;
  - kirim `cheer_total` ke semua pemain kalau sudah lewat 2 detik.
  - Sorak yang jatuh di sela waktu itu ikut terhitung di `total` dan terkirim bersama sorak berikutnya. Ini disebut **leading-edge throttle**. Kekurangannya: sorak terakhir dalam satu rentetan bisa terlambat tampil sampai ada sorak berikutnya. Untuk dekorasi, itu bisa diterima.

**HP:**
- Tombol Sorak sesuai board HP-3, dengan "tenaga sorak" berupa 5 garis turus. Setiap tekan memakai satu garis, yang terisi lagi satu setiap 0,6 detik.
- Tenaga habis → tombol tetap bisa ditekan, tapi tidak mengirim apa pun dan bergetar kecil (animasi `transform`).
- Getar HP: `navigator.vibrate(15)` kalau tersedia (Android). Safari di iPhone tidak mendukungnya, jadi cek dulu sebelum memanggil.
- Angka "Kelas sudah bersorak N kali" dari `cheer_total`.

**Proyektor (lobby):**
- Label nama dari `recent` naik dan memudar di sisi kanan bawah. Maksimal 6 tampil bersamaan; yang lebih dibuang.
- Angka total di sebelah logo.
- Saklar "Sorak tampil di layar" hanya di state UI host, tanpa pesan ke server. Default aktif.

**Test:** bucket sorak (6 sorak cepat → 5 diterima, socket tetap terbuka), throttle (beberapa sorak dalam 300 ms → satu `cheer` ke host dengan total benar), dan `react` di luar lobby diabaikan.

### B6. Di luar cakupan Hari 5

- **`explanation` end-to-end** (editor → `QuizSnapshot` → `reveal` / `result` → layar). Kolomnya sudah ada di D1, tapi alurnya belum. Catat sebagai task baru di Notion.
- "Terakhir dimainkan" di daftar kuis.
- Rapor Sorak lengkap dan kartu yang bisa diunduh (Hari 8).
- Peta Miskonsepsi dengan AI.

### B7. Uji manual Bagian B

1. Mainkan Kuis Demo dari awal sampai podium, dengan laptop sebagai proyektor dan 2–3 HP.
2. Periksa setiap layar terhadap board-nya, lalu catat perbedaan yang tidak disebut di B3.
3. Aktifkan "Kurangi gerakan" di OS (Android: Aksesibilitas, Hapus animasi). Semua layar tetap benar tanpa animasi.
4. Di Chrome DevTools, tab Performance, aktifkan CPU throttling 4x lalu rekam satu reveal papan skor. Tidak boleh ada frame yang macet lebih dari 50 ms.
5. Laporkan ukuran gzip JS halaman siswa (batas 200 KB).
6. Kalau B5 dikerjakan: 3 HP menekan Sorak bersamaan selama 10 detik. Socket tidak ada yang tertutup, dan angka di HP serta proyektor naik.

## Test minimum (ringkas)

- **Bagian A:** `game-event.ts`, alur kirim dan retry di GameRoom, consumer (idempotent, kuis terhapus, host hilang, poison message, retry, batas query), cron, REST riwayat (keyset, 404, indeks), dan fungsi laporan di web.
- **Bagian B:** `Tally` (jumlah garis untuk n = 0, 4, 5, 6, 27), `FlapDigits` (hanya digit yang berubah yang dianimasikan), urutan FLIP dari dua leaderboard (fungsi murni yang menghitung posisi lama dan baru), reducer untuk "naik X tingkat" dan statistik kolom kanan proyektor, dan B5 kalau dikerjakan.
