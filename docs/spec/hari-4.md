# Spec Hari 4: tahan sinyal jelek

- Tanggal: 2026-10-09
- Hasil akhir hari ini: game tetap adil dan tidak kehilangan jawaban walaupun sinyal kelas jelek.
  1. HP yang sinyalnya lambat tidak kalah poin hanya karena soal sampai lebih telat (**kompensasi latency**).
  2. HP yang putus di tengah game tersambung lagi sendiri, lalu langsung melihat soal aktif, sisa waktu, skor, dan peringkatnya, tanpa mengetik nama lagi (**resume**).
  3. Jawaban yang ditekan saat sinyal putus disimpan di HP dan dikirim begitu tersambung (**antrean jawaban offline**).
  4. Nama kasar ditolak saat join, dan guru bisa mengeluarkan pemain kapan saja (**moderasi dan kick**).
  5. Layar guru tahu siapa yang sedang terputus (**penanda `connected`**).
- Dokumen acuan:
  - CLAUDE.md, `.claude/rules/realtime.md`, dan `.claude/rules/web.md`;
  - `packages/shared/src`;
  - System Design bagian 7 (alur satu soal dan keadilan waktu), 8 (reconnect dan jawaban saat sinyal putus), dan 10 (keamanan);
  - Protokol WebSocket bagian 6.2–6.4 (sinyal putus, menjawab saat offline, dua tab) dan 7 (close code);
  - `docs/spec/hari-3.md` bagian 1 (aturan sementara yang hari ini diganti).
- **Kode Hari 1–3 yang sudah ada adalah acuan utama.** Kalau nama file, field, atau fungsi di spec ini berbeda dengan kode yang sudah jalan, ikuti kode dan sebutkan perbedaannya di rencana Fase 0.

## 1. Aturan sementara Hari 3 yang diganti hari ini

| Aturan Hari 3 | Pengganti Hari 4 |
|---|---|
| `t = min(tServer, T)`, `elapsedMs` dari HP diabaikan | `t` dihitung dengan rumus clamp (bagian 3), lalu dibatasi `T` |
| `ack` tidak dikirim dan tidak diproses | HP mengirim `ack` setiap menerima `question`; server memperbarui estimasi jeda sinyal |
| `resume` di luar lobby dibalas `GAME_ALREADY_STARTED` lalu ditutup 4011 | `resume` diterima di semua tahap (bagian 5) |
| HP yang putus menampilkan tombol "Masuk lagi" (join ulang) | HP tersambung ulang sendiri dengan backoff dan jitter, lalu mengirim `resume` |

Yang **tidak** berubah: jawaban yang tiba di tahap `grace` tetap diterima. `grace` adalah jendela toleransi 2 detik itu sendiri. Jawaban yang tiba setelah `reveal` tetap diabaikan, karena kunci jawaban sudah terlihat.

## 2. Perubahan di `packages/shared`

### Attachment pemain

`PlayerAttachment` bertambah satu field:

| Field | Tipe | Arti |
|---|---|---|
| `ackedQ` | `QuestionIndex.nullable()` | Nomor soal yang `ack`-nya sudah dipakai sebagai sampel latency |

Alasannya: satu soal hanya boleh menyumbang **satu** sampel latency. Tanpa field ini, HP curang bisa mengirim `ack` berkali-kali dengan jeda panjang supaya estimasi jedanya membesar, lalu mengklaim waktu jawab yang lebih cepat. Field ini ada di attachment, jadi tidak menambah tulis storage. Cek ukuran attachment kasus terburuk masih di bawah `ATTACHMENT_MAX_BYTES`.

### Hasil soal terakhir per pemain

Pemain yang tersambung lagi di tahap `reveal` perlu menerima ulang pesan `result`. Isinya: `outcome`, `correctIndex`, `points`, `score`, `rank`, `streak`.

- Kalau `PlayerScore` dari Hari 3 sudah menyimpan poin dan hasil soal terakhir, pakai field itu.
- Kalau belum lengkap, tambahkan `lastOutcome: z.enum(["correct", "wrong", "no_answer"]).nullable()` dan `lastPoints: z.number().int()` ke `PlayerScore`. Keduanya ditulis di `put` reveal yang sudah ada, jadi biaya tulisnya tetap.

### Konstanta baru

| Nama | Nilai | Arti |
|---|---|---|
| `RECONNECT_JITTER_RATIO` | 0.5 | Jeda reconnect = jeda dasar + acak antara 0 dan 50% jeda dasar |

### Protokol

- **Tidak ada pesan baru, dan `PROTOCOL_VERSION` tetap 1.** Semua pesan yang dibutuhkan (`ack`, `resume`, `kick`, `welcome` dengan snapshot, `player_joined`, `player_left`) sudah ada.
- Ada satu **perluasan makna** yang harus dicatat di dokumen Protokol (Surya yang memperbarui dokumen Drive-nya):
  - Di tengah game, `player_left` dengan `kicked: false` berarti pemain **terputus**. Pemain tetap ada di daftar host, dengan `connected: false`.
  - `player_joined` dengan `connected: true` untuk `playerId` yang sudah ada berarti pemain itu **tersambung lagi**.
  - Reducer host melakukan **upsert** berdasarkan `playerId`: perbarui kalau sudah ada, tambahkan kalau belum.
  - Di lobby, perilakunya tetap seperti Hari 2: pemain yang putus dihapus dari daftar.

## 3. Logika murni (dikerjakan dan diuji lebih dulu)

### `apps/realtime/src/latency.ts`

Dua fungsi murni. Semua angka diambil dari `constants.ts`.

**`updateLatency(previousMs: number | null, rttMs: number): number`**

- `sample = min(rttMs / 2, MAX_ONE_WAY_LATENCY_MS)`. Jeda satu arah diperkirakan setengah dari jeda pulang-pergi (RTT).
- Kalau `previousMs` null (sampel pertama): hasilnya `sample`.
- Kalau tidak: `(1 − LATENCY_EWMA_ALPHA) × previousMs + LATENCY_EWMA_ALPHA × sample`, dibulatkan, lalu dibatasi `MAX_ONE_WAY_LATENCY_MS`.
- Ini disebut **EWMA** (exponentially weighted moving average, rata-rata bergerak berbobot): sampel baru hanya mengubah 30% estimasi. Satu lonjakan sinyal sesaat tidak langsung merusak estimasi, tapi kalau sinyal memang memburuk, estimasinya ikut naik dalam beberapa soal.
- RTT negatif tidak mungkin terjadi karena dihitung dari jam server saja. Kalau tetap terjadi (bug), lempar error, jangan diam-diam diperbaiki.

**`compensateAnswerTime({ elapsedMs, tServerMs, latencyMs, timeLimitMs }): number`**

- `d = latencyMs ?? 0`. Pemain yang belum pernah mengirim `ack` diperlakukan seolah sinyalnya sempurna. Ini pilihan aman: ia tidak mendapat kelonggaran tambahan.
- `lower = max(0, tServerMs − 2 × d − LATENCY_EPSILON_MS)`.
- `t = clamp(elapsedMs, lower, tServerMs)`, lalu `t = min(t, timeLimitMs)`.

Cara membacanya:
- `tServerMs` adalah lama sejak soal dikirim sampai jawaban tiba, menurut jam server. Ini **batas atas**: HP tidak mungkin berpikir lebih lama dari itu.
- `tServerMs − 2d − ε` adalah **batas bawah**: soal butuh `d` untuk sampai ke HP, dan jawaban butuh `d` untuk kembali. Klaim HP yang lebih cepat dari itu secara fisik tidak mungkin, jadi dipotong.
- Klaim `elapsedMs` dari HP dipakai hanya kalau ada di antara kedua batas itu. Prinsipnya **trust but verify**: percaya klaim klien, tapi hanya dalam rentang yang bisa dibuktikan server.

Test `latency.test.ts`:
- `updateLatency`:
  - sampel pertama;
  - deret beberapa sampel dibandingkan hasil hitung tangan;
  - RTT 5000 ms dibatasi 1500;
  - RTT negatif melempar error.
- `compensateAnswerTime`:
  - klaim jujur di dalam rentang dipakai apa adanya;
  - klaim 0 ms dipotong ke batas bawah;
  - klaim lebih besar dari `tServer` dipotong ke `tServer`;
  - `latencyMs` null;
  - hasil tidak pernah di atas `T` dan tidak pernah negatif.

### Test keadilan `fairness.test.ts` (task Notion: "Test otomatis keadilan latency")

Simulasi murni tanpa WebSocket, memakai `updateLatency`, `compensateAnswerTime`, dan `scoreAnswer` dari Hari 3.

- **Skenario:**
  - mode Klasik, `T = 10.000 ms`, 5 soal;
  - dua pemain dengan waktu reaksi identik 3.000 ms;
  - Pemain A punya jeda satu arah 50 ms, Pemain B 800 ms;
  - setiap pemain mengirim `ack` lalu `answer`;
  - jeda tiap pesan diberi gangguan acak ±100 ms (**jitter**) memakai pembangkit acak dengan seed tetap, supaya hasilnya selalu sama.
- **Assert:** selisih total skor A dan B di bawah 5%.
- **Assert pembanding:** dengan rumus Hari 3 (`t = min(tServer, T)`), selisihnya **di atas** 5%. Assert ini membuktikan test-nya memang bisa membedakan rumus adil dan tidak adil, bukan lulus karena kebetulan.
- **Test curang:** Pemain C dengan jeda 50 ms mengklaim `elapsedMs = 0`. Poinnya tidak boleh lebih besar dari pemain jujur dengan jeda sama yang menjawab di 250 ms.

### `apps/realtime/src/moderation.ts`

`isNicknameAllowed(nickname: string): boolean`. Dipanggil GameRoom secara sinkron saat `join`. Daftar katanya ada di file data terpisah, `apps/realtime/src/blocked-words.ts`.

**Normalisasi sebelum dicek:**
1. `nicknameKey()` dari shared (NFKC, huruf kecil, spasi dirapikan).
2. Ganti angka dan simbol yang mirip huruf (**leetspeak**): `0→o`, `1→i`, `3→e`, `4→a`, `5→s`, `7→t`, `8→b`, `@→a`, `$→s`.
3. Huruf yang diulang tiga kali atau lebih dirapatkan jadi satu: "anjjjing" → "anjing".

**Dua daftar, dua cara cocok:**
- **`BLOCKED_ROOTS`**: kata panjang yang tidak mungkin muncul di nama wajar.
  - Dicocokkan sebagai **potongan teks** pada bentuk rapat, yaitu setelah spasi, titik, `_`, dan `-` dibuang. Jadi "a n j i n g" dan "anj.ing" tetap tertangkap.
  - Isi minimal: anjing, bangsat, bajingan, kontol, memek, ngentot, jancok, jancuk, bego, goblok, tolol, keparat, kampret, pelacur, lonte, perek, setan, sialan, fuck, bitch, pussy.
- **`BLOCKED_WORDS`**: kata pendek yang bisa muncul di dalam nama wajar.
  - Contohnya "asu" ada di dalam "Masuk" dan "Pasukan", dan "tai" ada di dalam "Sutaini".
  - Karena itu hanya dicocokkan sebagai **kata utuh**, setelah nickname dipecah per spasi, titik, `_`, dan `-`.
  - Isi minimal: asu, tai, babi, monyet, kunyuk, jembut, peler, coli, sex, porn, shit, dick. Dua yang terakhir ada di sini karena muncul di dalam nama seperti "Ashita" dan "Dicky".
- Pembagian ini menghindari **Scunthorpe problem**: filter yang menolak nama wajar karena di dalamnya kebetulan ada kata kasar.

**Kalau ditolak:**
- Kirim `error NICKNAME_REJECTED` dengan pesan "Nama ini tidak bisa dipakai. Coba nama lain."
- Socket tetap terbuka, sama seperti `NICKNAME_TAKEN`.
- Jangan sebutkan kata mana yang kena, supaya pesan error tidak menjadi alat untuk mencari celah filter.

Test `moderation.test.ts`:
- setiap entri di kedua daftar ditolak, termasuk varian huruf besar, leetspeak (`4nj1ng`), berspasi (`a n j i n g`), dan huruf berulang (`anjjjing`);
- nama wajar diterima: Masuk, Pasukan, Sutaini, Tasya, Bastian, Anjani, Dimas, Setiawan, Dicky, Ashita, Kampung Baru;
- kata pendek yang berdiri sendiri ditolak: "asu", "Si Tai", "babi_01".

Kalau ada nama wajar yang ikut tertolak oleh daftar di atas, laporkan dan pindahkan kata penyebabnya dari `BLOCKED_ROOTS` ke `BLOCKED_WORDS`. Jangan menambah pengecualian khusus untuk satu nama.

## 4. GameRoom: `ack` dan jawaban

### `ack` (pemain, tahap question atau grace)

- `q` bukan soal aktif → abaikan.
- `ackedQ === q` (sudah pernah mengirim `ack` untuk soal ini) → abaikan.
- Selain itu:
  - `rtt = now − state.questionSentAt`;
  - `latencyMs = updateLatency(latencyMs, rtt)`;
  - `ackedQ = q`;
  - simpan ke attachment (`serializeAttachment`, tanpa tulis storage).

`ack` hanya bermakna untuk socket yang menerima soal lewat broadcast. Socket yang tersambung lagi di tengah soal menerima soal lewat snapshot di `welcome`, dan HP **tidak** mengirim `ack` untuk snapshot (bagian 7). Selain itu, `ackedQ` socket baru disalin dari socket lama, sehingga `ack` susulan tetap ditolak.

### `answer`

Sama seperti Hari 3, kecuali cara menghitung `t`:
- `tServer = now − state.questionSentAt`;
- `t = compensateAnswerTime({ elapsedMs, tServerMs: tServer, latencyMs: attachment.latencyMs, timeLimitMs })`.

Jawaban di tahap `grace` tetap diterima. `t`-nya hampir selalu `T` atau mendekati `T`, karena `tServer` sudah melewati batas waktu. Artinya jawaban tetap dinilai benar atau salah, tapi poin kecepatannya paling kecil. Ini trade-off yang disengaja di System Design bagian 8: server tidak bisa memverifikasi klaim waktu dari HP yang sempat offline, jadi lebih aman sedikit merugikan pemain jujur daripada membuka celah curang.

## 5. GameRoom: resume di tengah game

### Peta pemain

Simpan di memori:
- `tokenHash → playerId` dari roster di storage;
- `playerId → socket` dari attachment.

Keduanya dibangun ulang di constructor. Setelah hibernasi, memori kosong, tapi roster ada di storage dan attachment ada di setiap socket.

### `resume` di tahap `question`, `grace`, `reveal`, `ended`

1. **Cari pemain.** Hash token yang dikirim (SHA-256 hex), lalu cari di roster.
   - Tidak ketemu → `error SESSION_INVALID`, lalu tutup 4003.
   - Ini juga yang terjadi pada pemain yang sudah di-kick, karena ia dihapus dari roster (bagian 6).
2. **Ambil data dari socket lama**, kalau masih ada socket lain dengan `playerId` yang sama (misalnya tab lama di HP yang sama): jawaban aktif, `latencyMs`, dan `ackedQ`.
   - Lalu ubah dulu attachment socket lama menjadi `{ role: "replaced" }`, baru tutup dengan 4002 `REPLACED`.
   - Urutan ini penting. `webSocketClose` untuk socket berperan `replaced` tidak melakukan apa-apa: tidak menulis `pending` dan tidak mengirim `player_left`. Tanpa itu, jawaban bisa tercatat dua kali dan host melihat pemain "keluar" padahal baru saja kembali.
   - Tambahkan `ReplacedAttachment` ke union `SocketAttachment`.
3. **Kalau tidak ada socket lama** dan tahapnya `question` atau `grace`, ambil jawaban dari key `pending:<playerId>:<q>` kalau ada. Jangan hapus key-nya: reveal sudah membuang duplikat (Hari 3), dan menghapus berarti satu tulis tambahan tanpa manfaat.
4. **Susun attachment baru:**
   - `playerId`, `nickname`, `tokenHash`, `teamSize` dari roster;
   - `score` dan `streak` dari `scoreboard` (0 kalau belum ada reveal);
   - `answer`, `latencyMs`, `ackedQ` dari langkah 2 atau 3, atau null.
5. **Kirim `welcome`** tanpa `sessionToken`. Isi snapshot-nya:

| Field | Isi |
|---|---|
| `phase` | Tahap saat ini |
| `question` | Soal aktif lewat `toPublicQuestion()` di tahap `question` dan `grace`; null di tahap lain |
| `remainingMs` | `max(0, deadlineAt − now)` di tahap `question`; null di tahap lain |
| `answered` | Pemain punya jawaban untuk soal aktif |
| `score`, `streak` | Dari attachment baru |
| `rank` | Peringkat dari scoreboard dengan competition ranking yang sama seperti reveal (fungsi yang sama, jangan ditulis ulang); null sebelum reveal pertama |
| `playerCount` | Jumlah pemain di roster |

6. **Kirim ulang pesan terakhir yang mungkin terlewat:**
   - tahap `reveal` → `result` untuk soal ini, dari `scoreboard` dan kunci jawaban di `quiz`;
   - tahap `ended` → `final`, dibangun dengan fungsi yang sama seperti saat game berakhir.
7. **Beri tahu host:** kirim `player_joined` dengan `connected: true`.

Biaya: **0 tulis storage**. Semuanya dari storage yang sudah ada dan attachment.

### `resume` di lobby

Tetap seperti Hari 2, tapi pakai langkah 2 di atas (tandai `replaced` sebelum menutup) supaya kedua jalur konsisten.

### `webSocketClose` pemain di tengah game

Seperti Hari 3: kalau perlu tulis `pending`, lalu kirim `player_left` dengan `kicked: false`. Pemain tetap ada di roster, jadi bisa kembali.

### `all_answered`

Tetap memakai socket pemain yang terbuka, seperti Hari 3. Pemain yang tersambung lagi tapi belum menjawab ikut dihitung. Pemain yang sedang terputus tidak ditunggu.

### `host_hello` di tengah game

`players` di `host_welcome` sekarang berisi **semua pemain di roster**, dengan `connected` sesuai ada tidaknya socket terbuka untuk `playerId` itu.

## 6. GameRoom: kick

`kick { playerId }` dari host. Boleh di tahap `lobby`, `question`, `grace`, `reveal` (sudah ada di `ALLOWED_PHASES`).

| Tahap | Langkah |
|---|---|
| `lobby` | Kirim `player_left` (`kicked: true`) ke host dan `lobby` ke pemain lain. Tutup socket pemain dengan 4001. Tidak ada tulis storage. |
| `question`, `grace`, `reveal` | Hapus pemain dari `roster` dan `scoreboard` dalam **satu** `put`. Hapus jawabannya kalau ada di key `pending`. Kirim `player_left` (`kicked: true`) ke host. Tutup socket-nya dengan 4001 kalau sedang tersambung. |

- `playerId` yang tidak ada → `error NOT_ALLOWED_NOW` dengan pesan "Pemain tidak ditemukan".
- Setelah kick di tengah game:
  - `answer_count.total` dan `playerCount` mengikuti roster yang baru;
  - reveal berikutnya tidak menyertakan pemain itu;
  - `resume` dengan token-nya mendapat 4003.
- Kick di lobby tidak mencegah anak yang sama join lagi dengan nama lain. Ini disengaja: menyimpan daftar hitam butuh tulis storage, sedangkan guru cukup menekan kick sekali lagi. Catat di ringkasan sebagai trade-off.
- Socket pemain yang di-kick diberi attachment `replaced` sebelum ditutup, supaya `webSocketClose` tidak mengirim `player_left` kedua.

## 7. Web

### Modul koneksi (`socket.ts` dari Hari 2)

Semua logika di bawah ini ada di modul koneksi, tidak di komponen.

**Reconnect otomatis:**
- Socket tertutup dan `shouldReconnect(code)` true → coba lagi setelah `RECONNECT_BACKOFF_MS[n] + random(0, RECONNECT_BACKOFF_MS[n] × RECONNECT_JITTER_RATIO)`.
  - `n` naik setiap percobaan gagal dan berhenti di elemen terakhir (5 detik).
  - Tidak ada batas jumlah percobaan selama halaman terbuka.
- **Jitter** (tambahan acak) penting saat WiFi kelas pulih: tanpa jitter, 200 HP mencoba tersambung di milidetik yang sama. Ini disebut **thundering herd**.
- Coba **langsung** (tanpa menunggu jeda) saat:
  - event `online` dari browser;
  - tab kembali terlihat (`visibilitychange`);
  - pemain menekan "Sambung sekarang".
- Heartbeat tidak dibalas dalam `HEARTBEAT.timeoutMs` → tutup socket sendiri, lalu masuk jalur reconnect yang sama.
- Setelah tersambung: kirim `resume` dengan token dari `localStorage`.
  - Tidak ada token → kirim `join` (hanya mungkin di lobby).
  - Reset `n` ke 0 setelah `welcome` diterima, bukan saat socket terbuka.

**Close code yang tidak di-reconnect, masing-masing dengan layar sendiri:**

| Kode | Tampilan |
|---|---|
| 4001 KICKED | "Kamu dikeluarkan dari ruang ini oleh guru." Hapus token. |
| 4002 REPLACED | "Sorak sedang dibuka di tab atau HP lain." Tombol "Pakai di sini" (sambung ulang dengan `resume`). |
| 4003 SESSION_INVALID | Hapus token. Di lobby: kembali ke form nama. Di tengah game: "Sesi tidak dikenali. Game sudah berjalan, jadi kamu belum bisa masuk lagi." |
| 4000 ROOM_CLOSED | "Game sudah selesai." |

**`ack`:** kirim `{ t: "ack", q }` begitu pesan `question` diterima dan lolos decode, sebelum layar dirender. Jangan kirim `ack` untuk soal yang datang lewat snapshot `welcome`.

**Antrean jawaban (outbox):**
- Setiap jawaban yang ditekan masuk ke antrean `{ q, choice, elapsedMs }`.
  - `elapsedMs` dihitung **saat ditekan**, dari `performance.now()` sejak soal tampil, bukan saat dikirim.
  - Antrean juga disalin ke `localStorage` per PIN (dibungkus try/catch), supaya jawaban selamat kalau halaman dimuat ulang.
- Kalau socket terbuka, langsung kirim. Jawaban **tetap di antrean** sampai `answer_received` untuk `q` itu datang. Ini pola **outbox**: pesan baru dihapus setelah ada bukti diterima, bukan setelah dikirim.
- Setelah `welcome` dari `resume`, putuskan dengan fungsi murni `decideQueuedAnswer(snapshot, queued)`:

| Keadaan | Keputusan |
|---|---|
| `snapshot.phase` adalah `question` atau `grace`, `snapshot.question.q === queued.q`, dan `snapshot.answered` false | Kirim ulang |
| `snapshot.answered` true | Buang (server sudah punya) |
| Selain itu (soal sudah lewat) | Buang |

- Kirim ulang aman karena server **idempotent** (Hari 3): jawaban dobel tetap dihitung satu.

### Layar siswa

Mengikuti board desain "HP: Koneksi terputus" dan "HP: Jawaban terkirim".

- **Terputus:**
  - "Sinyal putus sebentar";
  - "Jawaban yang sudah terkirim tetap aman. Sorak menyambung lagi sendiri.";
  - nomor percobaan dan hitung mundur sampai percobaan berikutnya;
  - tombol "Sambung sekarang".
  - Kalau sedang di tahap `question`, tambahkan: "Kalau tersambung sebelum waktunya habis, kamu masih bisa menjawab."
- **Menjawab saat terputus:** tombol jawaban tetap bisa ditekan selama hitung mundur lokal belum habis. Setelah ditekan: "Tersimpan. Dikirim begitu tersambung."
- **Setelah tersambung lagi:** layar langsung sesuai snapshot. Hitung mundur dilanjutkan dari `remainingMs`, bukan diulang dari awal.
- **Nama ditolak:** `NICKNAME_REJECTED` tampil di bawah kotak nama, sama seperti `NICKNAME_TAKEN`.

### Layar guru

- **Reconnect host:** modul yang sama, dengan `host_hello` sebagai pesan pembuka. Selama terputus, tampilkan strip kecil "Menyambung ulang…". Jangan menutupi soal di proyektor.
- **Penanda `connected`:**
  - Di tahap game, tampilkan "2 terputus" di samping "18 dari 27 sudah menjawab", hanya kalau angkanya lebih dari 0.
  - Di daftar pemain, pemain yang terputus tampil redup.
- **Kick:**
  - di lobby, tekan nama pemain;
  - di layar `reveal`, tekan baris papan skor.
  - Keduanya membuka konfirmasi "Keluarkan Rara dari ruang ini?" dengan tombol "Keluarkan" dan "Batal".
  - Setelah `player_left` (`kicked: true`), nama hilang dari daftar.

### Reducer

Perbarui reducer layar siswa dan guru beserta test-nya, dengan urutan pesan sungguhan:
- **Siswa:** `welcome` (snapshot `question`, `answered: false`, `remainingMs: 7000`) → kirim ulang dari antrean → `answer_received` → `grace` → `result`.
- **Guru:** `host_welcome` → `player_left` (`kicked: false`) → `player_joined` (`connected: true`, `playerId` sama) → daftar tetap satu baris dengan `connected: true`.

## 8. Test minimum

### Logika murni
- `latency.test.ts`, `fairness.test.ts`, `moderation.test.ts` (bagian 3).
- `decideQueuedAnswer` di web (bagian 7).

### GameRoom (vitest-pool-workers)

**`ack`:**
- `ack` pertama mengubah `latencyMs`, `ack` kedua untuk soal yang sama tidak;
- `ack` untuk soal lain diabaikan.

**Resume:**
- resume di tahap `question` → snapshot berisi soal, `remainingMs` yang masuk akal, `answered: false`, dan skor dari reveal sebelumnya;
- pemain menjawab, socket ditutup (`pending` tertulis), lalu resume → `answered: true`, dan di reveal jawabannya dihitung **sekali**;
- resume dari socket kedua saat socket pertama masih terbuka → socket pertama ditutup 4002, host **tidak** menerima `player_left`, dan jawaban aktif pindah ke socket baru;
- resume di tahap `reveal` → `welcome`, lalu `result` yang sama dengan yang diterima pemain lain;
- resume di tahap `ended` → `welcome`, lalu `final`;
- token tidak dikenal → 4003;
- `evictDurableObject` di tengah soal, lalu resume → berhasil (roster dari storage);
- host menerima `player_left` (`kicked: false`) saat putus dan `player_joined` (`connected: true`) saat kembali.

**Kick:**
- kick di lobby → 4001 dan `player_left` (`kicked: true`);
- kick di tengah soal:
  - `answer_count.total` berkurang;
  - reveal berikutnya tanpa pemain itu;
  - resume dengan token-nya → 4003;
  - laporkan jumlah tulis storage-nya;
- kick `playerId` tidak dikenal → `NOT_ALLOWED_NOW`.

**Moderasi:** join dengan nama kasar → `NICKNAME_REJECTED`, socket tetap terbuka, lalu join dengan nama lain berhasil di socket yang sama.

**Kompensasi end-to-end:** satu pemain dengan `latencyMs` besar (atur lewat `ack` yang ditunda) dan klaim `elapsedMs` jujur mendapat poin dalam 5% dari pemain tanpa jeda.

### Web
- Reducer siswa dan guru (bagian 7).
- Modul koneksi dengan WebSocket palsu dan fake timer:
  - jadwal backoff berada dalam batas jitter;
  - `resume` dikirim setelah reconnect;
  - close 4001, 4002, 4003 tidak memicu reconnect;
  - `online` memicu percobaan langsung.

## 9. Uji manual

1. `pnpm dev` dan `pnpm --filter web dev --host`. Guru di laptop, 2–3 HP sebagai siswa.
2. **Putus 30 detik** (kriteria selesai di Notion):
   - Di tengah soal, aktifkan mode pesawat di satu HP selama 30 detik, lalu matikan lagi.
   - HP tersambung sendiri tanpa mengetik nama, skor dan soal aktif pulih, dan layar guru menampilkan "1 terputus" lalu kembali normal.
3. **Jawab saat offline:** mode pesawat, tekan jawaban, lalu matikan mode pesawat dalam 2 detik setelah waktu habis. Jawaban dihitung di reveal.
4. **Terlambat:** sama seperti langkah 3, tapi tunggu sampai reveal. Jawaban tidak dihitung, dan HP menampilkan hasil "Tidak menjawab".
5. **Sinyal lambat:**
   - Di Chrome DevTools salah satu perangkat, set throttling "Slow 4G" atau profil custom dengan latency 800 ms.
   - Dua orang menjawab bersamaan setelah aba-aba.
   - Catat selisih poinnya untuk laporan.
6. **Dua tab:** buka `/play/:pin` yang sama di tab kedua HP yang sama. Tab lama menampilkan "Sorak sedang dibuka di tab atau HP lain".
7. **Kick:** keluarkan satu pemain di lobby dan satu di tengah game.
8. **Nama kasar:** coba beberapa nama dari daftar dan beberapa nama wajar yang mirip.

## 10. Dokumentasi

- ADR baru dengan nomor berikutnya di `docs/adr/`: **"Kompensasi latency dan jendela toleransi"**.
  - Claude Code menulis Konteks, Opsi yang dipertimbangkan (jam server saja, percaya klien sepenuhnya, clamp dengan EWMA), dan Konsekuensi.
  - Bagian **Keputusan** ditulis Surya dengan kata-katanya sendiri. Claude Code meninggalkan bagian itu dengan judul saja dan menyebutkannya di ringkasan.
- Catat untuk Surya: dokumen Protokol perlu diperbarui untuk perluasan makna `player_joined` / `player_left` (bagian 2).

## 11. Di luar cakupan Hari 4

- Tombol Sorak (`react`) dan tampilannya di proyektor: Hari 5, bersama polesan desain.
  - Catatan untuk Hari 5: token bucket per socket menutup socket dengan 4008 kalau lewat 10 pesan per detik. Spam tombol Sorak tidak boleh sampai ke batas itu. Klien dibatasi "tenaga sorak", dan server membuang `react` berlebih tanpa menutup socket.
- Event `game_ended` ke Queue dan riwayat (Hari 5).
- Polesan desain dan motion layar proyektor dan HP (Hari 5).
- Daftar hitam nickname yang bertahan setelah kick.
- Moderasi kasus ragu dengan Workers AI (di Worker, bukan di jalur game live).
