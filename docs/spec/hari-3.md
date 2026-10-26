# Spec Hari 3: game loop, dari Mulai sampai podium

- Tanggal: 2026-10-09
- Hasil akhir hari ini: satu game 5 soal bisa dimainkan dari awal sampai akhir.
  1. Guru memilih mode skor (Klasik atau Akurat), lalu menekan Mulai.
  2. Soal muncul serentak di HP, dengan hitung mundur.
  3. Siswa menjawab. Waktu habis dipicu alarm.
  4. Setelah jendela toleransi 2 detik, kunci jawaban dibuka: layar guru menampilkan sebaran jawaban dan papan skor, HP menampilkan benar/salah, poin, dan peringkat.
  5. Guru menekan Lanjut sampai soal terakhir, lalu podium.
- Dokumen acuan:
  - CLAUDE.md dan `.claude/rules/realtime.md`;
  - `packages/shared/src`;
  - PRD bagian "Mode permainan & aturan skor";
  - System Design bagian 6 (siklus hidup room) dan 7 (alur satu soal).

## 1. Batas hari ini dan alasannya

Hari 4 mengerjakan kompensasi latency, reconnect di tengah game, dan antrean jawaban offline. Supaya Hari 3 tetap utuh tanpa kode setengah jadi, ada tiga aturan sementara yang disengaja:

1. **Waktu jawab memakai jam server saja.**
   - `t = min(tServer, T)`, dengan `tServer = waktu jawaban diterima − questionSentAt` dan `T` adalah batas waktu soal.
   - `elapsedMs` dari HP divalidasi skema tapi belum dipakai.
   - Akibatnya, HP bersinyal lambat masih sedikit dirugikan. Ini yang diperbaiki rumus `clamp` di Hari 4.
   - Jawaban yang tiba di tahap GRACE tetap diterima dengan `t = T`. Dengan begitu jawaban yang tertahan jaringan tetap dinilai benar atau salah, hanya poin kecepatannya paling kecil. Aturan ini sama dengan System Design bagian 8 untuk jawaban offline.
2. **Pesan `ack` belum dikirim web dan belum diproses server.** Pemakaiannya sebagai pengukur latency dimulai Hari 4.
3. **`resume` di luar lobby belum didukung.**
   - Server membalas `error GAME_ALREADY_STARTED` dengan pesan "Masuk ulang di tengah game tersedia di versi berikutnya", lalu menutup socket dengan 4011.
   - Jawaban yang sudah dikirim sebelum putus tetap dihitung, lewat key `pending` (bagian 4).

Event `game_ended` ke Queue dikerjakan di Hari 5, sehingga hari ini hasil game belum tersimpan ke D1.

## 2. Perubahan di `packages/shared`

### Konstanta baru

| Nama | Nilai | Arti |
|---|---|---|
| `CLASSIC_MAX_POINTS` | 1000 | Poin jawaban benar tercepat di Klasik |
| `CLASSIC_MIN_FACTOR` | 0.5 | Jawaban benar paling lambat di Klasik mendapat 50% |
| `ACCURATE_POINTS` | 1000 | Poin jawaban benar di Akurat |
| `COMBO_STEP_POINTS` | 50 | Bonus per jawaban benar beruntun |
| `COMBO_MAX_POINTS` | 250 | Batas bonus kombo |
| `REVEAL_IDLE_TIMEOUT_MS` | 1.800.000 (30 menit) | Room di tahap reveal yang ditinggal host ditutup |
| `ENDED_RETENTION_MS` | 600.000 (10 menit) | Lama room bertahan setelah game selesai sebelum dibersihkan |

### REST room

- `CreateRoomInput` bertambah `scoringMode: ScoringMode.extract(["classic", "accurate"])`. Mode `confidence` (Taruhan Yakin) ditambahkan di Hari 7.
- Tidak ada perubahan pesan WebSocket. Semua pesan yang dibutuhkan hari ini (`start`, `next`, `end`, `answer`, `question`, `answer_received`, `answer_count`, `grace`, `reveal`, `result`, `podium`, `final`) sudah ada di protokol.

## 3. Logika murni (dikerjakan dan diuji lebih dulu)

Pola hari ini disebut **functional core, imperative shell**:

- **Inti fungsional**: semua aturan permainan (transisi tahap, skor, peringkat) ditulis sebagai fungsi murni. Fungsi murni artinya: input sama, output selalu sama, dan tidak menyentuh storage, socket, atau jam.
- **Cangkang imperatif**: GameRoom hanya membaca state, memanggil fungsi murni itu, lalu menulis storage dan mengirim pesan.
- Hasilnya, aturan yang rumit bisa diuji ribuan kali dalam milidetik tanpa WebSocket sungguhan.

### `apps/realtime/src/phase.ts`: state machine

- Tabel transisi sebagai data, sama seperti `ALLOWED_PHASES`:

| Dari | Event | Ke |
|---|---|---|
| `lobby` | `start` | `question` |
| `lobby` | `end` | (room dibatalkan, sama seperti Hari 2) |
| `question` | `deadline` atau `all_answered` | `grace` |
| `grace` | `grace_over` | `reveal` |
| `reveal` | `next` (masih ada soal) | `question` |
| `reveal` | `next` (soal terakhir) atau `idle_timeout` | `ended` |
| `question`, `grace`, `reveal` | `end` | `ended` |
| `ended` | `retention_over` | (ditutup: semua socket 4000, `deleteAll`) |

- Fungsi `nextPhase(phase, event)` mengembalikan tahap berikutnya, atau penanda "tidak sah". Transisi yang tidak ada di tabel ditolak, dan GameRoom mencatatnya di log tanpa mengubah apa pun.
- Test: setiap baris tabel, ditambah beberapa transisi tidak sah, misalnya `next` di `question` dan `deadline` di `reveal`.

### `apps/realtime/src/scoring.ts`: skor satu jawaban

`scoreAnswer({ mode, correct, tMs, timeLimitMs, previousStreak })` mengembalikan `{ points, streak }`:

- **Salah atau tidak menjawab**: `points = 0`, `streak = 0`.
- **Benar**: `streak = previousStreak + 1`, dan `points = poin dasar + bonus kombo`.
  - **Poin dasar Klasik**: `round(CLASSIC_MAX_POINTS × (1 − CLASSIC_MIN_FACTOR × t / T))`, dengan `t` dibatasi ke rentang `0..T`. Jadi t = 0 menghasilkan 1000, dan t = T menghasilkan 500.
  - **Poin dasar Akurat**: `ACCURATE_POINTS`.
  - **Bonus kombo**: `min(COMBO_STEP_POINTS × (streak − 1), COMBO_MAX_POINTS)`. Jawaban benar pertama tanpa bonus, benar kedua berturut-turut +50, ketiga +100, dan seterusnya sampai paling banyak +250 mulai benar keenam.

Test:
- batas t = 0, t = T, dan t > T;
- deret 7 jawaban benar → bonus 0, 50, 100, 150, 200, 250, 250;
- jawaban salah di tengah deret me-reset kombo;
- Akurat tidak dipengaruhi t.

### `apps/realtime/src/reveal.ts`: membuka kunci satu soal

`revealQuestion({ question, questionIndex, mode, roster, scoreboard, answers })` mengembalikan:

- `scoreboard` baru untuk **semua pemain di roster**, termasuk yang sudah putus. Pemain tanpa jawaban dihitung `no_answer`.
- `stats`: `QuestionStats` soal ini (`answerCounts` per opsi, `answered`, `correct`, `totalCorrectMs`; `confidentWrong` tetap 0 sampai Hari 7).
- `results`: satu hasil per pemain (`outcome`, `points`, `score`, `rank`, `streak`). Bahan pesan `result`.
- `leaderboard`: maksimal `LEADERBOARD_SIZE` entri. `delta` adalah poin soal ini.

Aturan peringkat:
- Urutkan berdasarkan skor, terbesar dulu. Skor sama mendapat peringkat sama (**competition ranking**: 1, 2, 2, 4).
- Untuk urutan tampil di papan skor, skor sama diurutkan berdasarkan `nicknameKey` supaya hasilnya selalu sama (**deterministik**).

Perbarui juga statistik per pemain di `PlayerScore`:
- `correct`, `answered`, `bestStreak`;
- `fastestCorrectMs` (t terkecil dari jawaban benar);
- `worstRank` dan `biggestRankClimb = max(lama, worstRank − rank sekarang)`.

Semuanya untuk Rapor Sorak nanti. Biayanya hampir nol karena dihitung bersamaan.

`answers` adalah gabungan jawaban dari attachment socket yang masih terbuka dan dari key `pending`. Kalau satu pemain punya keduanya, hanya satu yang dihitung.

Test:
- 3 pemain dengan campuran benar, salah, dan tidak menjawab;
- skor seri;
- pemain yang putus tetap ada di scoreboard;
- jawaban `pending` ikut dihitung;
- duplikat antara attachment dan `pending` dihitung sekali.

## 4. GameRoom (`apps/realtime`)

### `init`

Menerima `scoringMode` dari Worker (skema `InitRoomInput` sudah memuatnya), lalu menyimpannya di `state`.

### `start` (dari host, tahap lobby)

- Tanpa pemain yang sudah join: kirim `error NOT_ALLOWED_NOW` dengan pesan "Belum ada pemain".
- Kalau ada:
  - Simpan **snapshot roster** dari attachment pemain (`playerId`, `nickname`, `tokenHash`, `teamSize`) ke key `roster`. Ini satu-satunya tulis roster selama game.
  - Mulai soal pertama (lihat "Memulai satu soal").

### Memulai satu soal

- Ambil satu timestamp `now` di awal handler.
- `state`: phase `question`, `questionIndex`, `questionSentAt = now`, `deadlineAt = now + timeLimitSec × 1000`, `startedAt` diisi saat soal pertama.
- Satu `put` untuk `state` (dan `roster` saat soal pertama), lalu `setAlarm(deadlineAt)`.
- Bersihkan jawaban soal sebelumnya di attachment setiap pemain (`answer: null`).
- Encode pesan `question` sekali dengan `toPublicQuestion()`, lalu kirim ke semua socket pemain dan host.

### `answer` (pemain, tahap question atau grace)

1. `q` bukan soal aktif → abaikan dan catat di log.
2. `choice` ≥ jumlah opsi soal → `error BAD_MESSAGE` (dihitung ke penghitung pesan rusak).
3. Pemain sudah punya jawaban untuk `q` → kirim `answer_received` lagi tanpa mengubah apa pun. Inilah **idempotent**: tombol ditekan berkali-kali, hasilnya tetap satu jawaban. Klien yang tidak sempat menerima balasan pertama tetap mendapat konfirmasi.
4. Selain itu:
   - hitung `t` (bagian 1);
   - simpan `ActiveAnswer` di attachment, tanpa tulis storage;
   - kirim `answer_received` ke pemain;
   - kirim `answer_count` ke host. `total` adalah jumlah pemain di roster.
5. Tahap `question` dan semua pemain yang socket-nya terbuka sudah menjawab → transisi `all_answered`, jangan menunggu alarm.

### Alarm

Satu alarm per objek. Handler `alarm()` memutuskan langkah dari `state.phase`:

| Tahap saat alarm berbunyi | Langkah |
|---|---|
| `lobby` | Seperti Hari 2 (cek host tersambung) |
| `question` | Ke `grace`: simpan `state`, `setAlarm(now + GRACE_MS)`, kirim `grace` ke semua |
| `grace` | Ke `reveal` (lihat di bawah) |
| `reveal` | Host tidak menekan Lanjut selama `REVEAL_IDLE_TIMEOUT_MS` → ke `ended` |
| `ended` | Tutup semua socket dengan 4000, lalu `deleteAll()` |

Transisi `all_answered` memakai jalur yang sama dengan alarm `question`: alarm deadline diganti alarm grace.

### Reveal

1. Kumpulkan jawaban soal ini:
   - dari attachment socket pemain;
   - dari key `pending:<playerId>:<q>` (`ctx.storage.list({ prefix })`).
2. Panggil `revealQuestion`.
3. Satu `put` berisi `state` (phase `reveal`), `scoreboard`, dan `qstats`. Lalu hapus key `pending` soal ini.
4. `setAlarm(now + REVEAL_IDLE_TIMEOUT_MS)`.
5. Perbarui `score` dan `streak` di attachment setiap socket pemain yang terbuka.
6. Kirim:
   - `reveal` ke host: `correctIndex`, `counts`, `answered`, `total`, `leaderboard`, `isLastQuestion`;
   - `result` ke setiap pemain sesuai hasilnya.

### `next` (host, tahap reveal)

Masih ada soal → mulai soal berikutnya. Soal terakhir → `ended`.

### `ended` (dari `next` terakhir, `end` dari host, atau idle timeout)

- `state`: phase `ended`, `endedAt`.
- `setAlarm(now + ENDED_RETENTION_MS)`.
- Kirim `podium` (3 besar, `gameId`, jumlah pemain) ke host, dan `final` ke setiap pemain. `final` berisi skor, peringkat, jumlah pemain, dan `highlights` dari `PlayerScore`.
- `end` yang dikirim di tengah soal tidak membuka kunci soal itu; podium memakai scoreboard terakhir.

### Socket pemain tertutup di tengah game

- Kalau tahapnya `question` atau `grace` dan pemain sudah punya jawaban untuk soal aktif, tulis jawaban itu ke `pending:<playerId>:<q>` **sebelum attachment hilang**. Ini satu-satunya tulis storage per pemain, dan hanya terjadi untuk pemain yang putus.
- Kirim `player_left` (`kicked: false`) ke host.

### `host_hello` di tengah game

Layar guru bisa di-refresh kapan saja. `host_welcome` harus berisi:
- tahap saat ini;
- soal aktif dan `remainingMs = max(0, deadlineAt − now)`;
- jumlah yang sudah menjawab.

Lalu:
- tahap `reveal`: kirim ulang pesan `reveal`, dibangun dari `scoreboard` dan `qstats` di storage;
- tahap `ended`: kirim ulang `podium`.

### `join` / `resume` di luar lobby

- `join` → `error GAME_ALREADY_STARTED`, lalu tutup 4011.
- `resume` → seperti bagian 1 poin 3.

### Biaya tulis storage per soal

Sekitar 7 baris:
- `state` dan alarm saat soal dimulai;
- `state` dan alarm saat grace;
- `state`, `scoreboard`, `qstats`, dan alarm saat reveal.

Ditambah 1 baris per pemain yang putus sambil memegang jawaban. Laporkan angka sebenarnya dari test end-to-end.

**Terukur (Fase C, 2026-10-08):** 8 baris per soal (5 key `put` + 3 alarm). Pemain yang putus memegang jawaban menambah 1 `put` dan 1 `delete`. Soal pertama menambah 1 baris untuk `roster`. Diukur dengan menghitung pemanggilan storage di test, bukan metrik tagihan Cloudflare.

## 5. API Worker

`POST /api/rooms` menerima `scoringMode` lalu meneruskannya ke `init`. Perbarui test-nya.

## 6. Web

### Halaman `/quizzes`

Tombol "Mainkan" membuka pilihan mode:
- **Klasik**: "cepat dan benar";
- **Akurat**: "benar saja, tanpa tekanan waktu".

Setelah memilih, `POST /api/rooms`.

### Layar guru (`/host/:pin`)

| Tahap | Tampilan |
|---|---|
| lobby | Seperti Hari 2, ditambah mode skor dan tombol **Mulai** (nonaktif kalau belum ada pemain) |
| question | Nomor soal (3/5), teks soal besar, pilihan dengan bentuk dan warnanya, hitung mundur besar, "27/36 sudah menjawab" |
| grace | "Menghitung jawaban…" |
| reveal | Pilihan benar disorot, batang sebaran jawaban per pilihan, papan skor 10 besar dengan perubahan poin, tombol **Lanjut** (atau **Lihat podium** di soal terakhir) |
| ended | Podium 3 besar, jumlah pemain, tombol **Selesai** ke `/quizzes` |

Tombol **Akhiri game** (kirim `end`) tersedia di semua tahap game, dengan konfirmasi.

### Layar siswa (`/play/:pin`)

| Tahap | Tampilan |
|---|---|
| question | Teks soal, tombol pilihan besar (bentuk + warna + huruf A–D), hitung mundur. Setelah ditekan: "Mengirim…", lalu "Jawaban terkirim" setelah `answer_received`. Saat hitung mundur lokal habis, tombol nonaktif |
| grace | "Menghitung jawaban…" |
| result | Benar / Salah / Tidak menjawab, poin yang didapat, total skor, peringkat, dan "Kombo N×" kalau streak ≥ 2 |
| ended | Skor akhir dan "Peringkat X dari Y" |

### Ketentuan

- **Hitung mundur** berjalan dari `durationMs` (atau `remainingMs` di snapshot) dan `performance.now()` sejak pesan diterima. Jangan pakai `Date.now()` HP.
- **Bentuk pilihan** (misalnya segitiga, belah ketupat, lingkaran, persegi) dan warnanya didefinisikan sekali di design token. Warna saja tidak cukup untuk siswa buta warna.
- **Pesan masuk menggerakkan layar**: satu reducer per layar, dengan input pesan server dan output state tampilan, tanpa efek samping. Reducer ini fungsi murni, jadi wajib diuji dengan urutan pesan sungguhan, misalnya `welcome` → `question` → `answer_received` → `grace` → `result` → `final`.
- **Ukuran JS halaman siswa tetap di bawah 200 KB gzip**. Laporkan angkanya.

## 7. Test minimum

- **Logika murni** (bagian 3): `phase.ts`, `scoring.ts`, `reveal.ts`.
- **GameRoom** (vitest-pool-workers): satu game 3 soal dengan 2 pemain dan 1 host.
  - Waktu dimajukan dengan `runDurableObjectAlarm`.
  - Periksa urutan pesan ke setiap pihak, benar/salah, skor naik sesuai mode, dan podium di akhir.
  - Nilai poin pastinya bergantung pada jam, jadi cek rentangnya saja. Rumus pastinya sudah diuji di `scoring.ts`.
- **Kasus GameRoom**:
  - `start` tanpa pemain → `NOT_ALLOWED_NOW`;
  - jawaban dobel → satu jawaban dan dua `answer_received`;
  - jawaban untuk soal lain diabaikan;
  - `choice` di luar opsi → `BAD_MESSAGE`;
  - semua menjawab → `grace` sebelum deadline;
  - jawaban yang tiba di `grace` dihitung dengan t = T;
  - pemain putus setelah menjawab → jawabannya tetap dihitung di reveal;
  - `next` di `question` → `NOT_ALLOWED_NOW`;
  - `end` di tengah soal → podium;
  - `host_hello` di tengah `question` mendapat `remainingMs`;
  - `host_hello` di `reveal` mendapat ulang `reveal`;
  - alarm `ended` → storage kosong;
  - `join` di tengah game → 4011;
  - `evictDurableObject` di tengah soal, lalu alarm berbunyi → reveal tetap benar (state, roster, dan jawaban di attachment pulih).
- **API**: `scoringMode` diteruskan ke `init`, dan mode `confidence` ditolak 400.
- **Web**: reducer layar guru dan layar siswa.

## 8. Uji manual

1. `pnpm dev` dan `pnpm --filter web dev --host`. Guru di laptop, 2–3 HP sebagai siswa.
2. Mainkan Kuis Demo sampai 5 soal dengan mode Klasik:
   - satu HP selalu menjawab cepat dan benar;
   - satu HP menjawab lambat;
   - satu HP sengaja salah di soal 3.

   Periksa: poin yang cepat lebih besar, kombo putus di soal 3, peringkat masuk akal, podium benar.
3. Ulangi dengan mode Akurat: semua jawaban benar bernilai 1000 + kombo, berapa pun kecepatannya.
4. Refresh layar guru di tengah soal. Soal dan hitung mundur muncul kembali dengan sisa waktu yang benar.
5. Matikan WiFi satu HP setelah ia menjawab, sebelum waktu habis. Di reveal, jawabannya tetap dihitung.
6. Catat untuk laporan:
   - jeda dari guru menekan Mulai sampai soal tampil di HP (target < 500 ms, terasa "serentak");
   - jumlah tulis storage per soal.

## 9. Di luar cakupan Hari 3

- Kompensasi latency dan `ack` (Hari 4).
- Reconnect dan resume di tengah game (Hari 4).
- Antrean jawaban offline di HP (Hari 4).
- Kick dan moderasi nickname (Hari 4).
- Penanda `connected` di daftar pemain host (Hari 4).
- Event `game_ended` ke Queue dan riwayat (Hari 5).
- Polesan desain layar proyektor dan HP (Hari 5).
- Taruhan Yakin dan Mode Tim (Hari 7).
- Gambar soal.
