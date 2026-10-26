# Uji end-to-end MVP (F-01 sampai F-10)

- Tanggal: 2026-10-26 (Hari 6)
- Kode: commit `3a843c1` ditambah perubahan Hari 6 Fase 5
- Test otomatis: `pnpm -r typecheck` dan `pnpm -r test` lulus di 5 paket (661 test: shared 132, ai-eval 17, web 155, realtime 210, api 147)
- MVP dinyatakan selesai kalau semua baris di bawah berstatus **Lulus** atau **Diubah dengan alasan**, dan tidak ada bug kritis yang terbuka.

Arti kolom Hasil:
- **Lulus (otomatis)**: dibuktikan test yang berjalan di setiap `pnpm -r test`.
- **Lulus (manual)**: dibuktikan langkah manual, dengan tanggal dan catatan.
- **Menunggu**: langkah manual atau evaluasi belum dijalankan. Diisi Surya setelah menjalankan langkah di bagian 2 dan 3.
- **Diubah dengan alasan**: target PRD sengaja diganti, dengan alasan tertulis di ADR.

Nama test ditulis sebagai `file › describe › it`.

## 1. Tabel acceptance criteria

| ID | Acceptance criteria (dari PRD) | Cara uji | Hasil | Bukti |
|---|---|---|---|---|
| F-01 | Kuis 10 soal tersimpan dan bisa diedit; input divalidasi di server | Test API CRUD dan validasi; manual: buat kuis 10 soal di production, ubah, simpan, buka lagi | Lulus (otomatis); manual menunggu (langkah 3.1) | `apps/api/test/quizzes.test.ts › CRUD kuis › membuat, membaca, mendaftar, mengubah, lalu menghapus kuis`; `› validasi body › body tidak valid: 400 VALIDATION_FAILED dengan fields per kotak`; `› validasi body › body di atas QUIZ_BODY_MAX_BYTES: 413`; `apps/api/test/seed.test.ts › seed lokal › … satu kuis demo berisi 10 soal yang lolos QuizDetail`. Catatan: "gambar opsional" di user story belum dibuat (Hari 1 menunda upload gambar, `image_url` tetap null); acceptance criteria tidak memintanya. |
| F-02 | Masuk lobby kurang dari 5 detik; tebakan PIN dibatasi (rate limit); nickname kembar ditolak | Test rate limit dan nickname; manual: ukur waktu dari menekan Masuk sampai lobby di HP | Rate limit: **Diubah dengan alasan** (10 → 120 per menit per IP, ADR 0005). Nickname kembar: Lulus (otomatis). Waktu masuk lobby: menunggu (langkah 3.2) | `apps/api/test/rooms.test.ts › GET /api/rooms/:pin › batas tebakan PIN habis -> 429 RATE_LIMITED, dengan IP sebagai kunci`; `› PIN_LOOKUP_LIMIT sama dengan binding ratelimits di wrangler.jsonc`; `apps/realtime/test/game-room.test.ts › join › Dimas lalu dimas -> NICKNAME_TAKEN …`. ADR 0005: satu kelas di WiFi sekolah terlihat sebagai satu IP, dan setiap siswa membuat 2 request (cek PIN dan WebSocket), jadi dengan batas 10 per menit siswa ke-6 sudah ditolak. Dengan 120 per menit, satu IP cukup untuk 60 siswa per menit, dan penebak dari satu IP berpeluang sekitar 0,17 kali per hari menemukan room. Sejak Hari 4, WebSocket pemain memakai batas terpisah (600 per menit) untuk reconnect massal. |
| F-03 | Nama dan jumlah pemain muncul di layar host kurang dari 1 detik setelah join | Test pesan player_joined; manual: stopwatch dari Masuk di HP sampai nama tampil di proyektor | Pesan: Lulus (otomatis). Waktu: menunggu (langkah 3.2) | `apps/realtime/test/game-room.test.ts › join › pemain menerima token, host menerima player_joined, pemain lain menerima lobby`; `apps/web/test/screens.test.ts › layar guru › lobby -> question -> …`. Catatan Hari 5: uji live room 409558 dengan 3 HP, nama tampil seketika (tanpa angka terukur). |
| F-04 | Jawaban setelah batas waktu (plus toleransi) ditolak; tekan berkali-kali hanya dihitung sekali | Test game loop | Lulus (otomatis) | `apps/realtime/test/game.test.ts › kasus game › jawaban dobel -> satu jawaban, dua answer_received`; `› jawaban yang tiba di grace (setelah batas waktu) tetap dinilai …`; `apps/realtime/test/reveal.test.ts › revealQuestion › jawaban pending ikut dihitung, duplikat attachment + pending dihitung sekali`; `apps/web/test/screens.test.ts › layar siswa › jawaban hanya bisa dipilih sekali per soal` |
| F-05 | Skor sesuai rumus di bagian Mode permainan; diuji dengan unit test | Unit test skor Klasik, Akurat, Kombo | Lulus (otomatis) | `apps/realtime/test/scoring.test.ts › scoreAnswer Klasik`, `› kombo › 7 jawaban benar beruntun: bonus 0, 50, 100, 150, 200, 250, 250`, `› scoreAnswer Akurat`; `apps/realtime/test/game.test.ts › satu game 3 soal … › Klasik …` dan `› Akurat …` |
| F-06 | Putus sampai 30 detik lalu tersambung: state dan skor pulih tanpa join ulang | Test resume; manual: mode pesawat 30 detik di tengah soal | Resume: Lulus (otomatis). Putus 30 detik di production: menunggu (langkah 3.4) | `apps/realtime/test/reconnect.test.ts › resume di tengah game › menjawab, putus (pending tertulis), lalu resume: answered true dan jawabannya dihitung sekali`; `› di tahap question: snapshot berisi soal, sisa waktu, belum menjawab, dan skor …`; `apps/web/test/player-session.test.ts › player session › jawaban ditekan saat sinyal putus: tertahan, lalu dikirim ulang setelah resume …` |
| F-07 | Uji otomatis: pemain dengan latency 800 ms dan 50 ms dengan waktu reaksi sama mendapat skor setara (selisih di bawah 5%) | Test keadilan latency | Lulus (otomatis) | `apps/realtime/test/fairness.test.ts › keadilan latency … › dengan kompensasi: selisih skor 50 ms vs 800 ms di bawah 5%` (pembandingnya, `› dengan jam server saja … selisihnya di atas 5%`, membuktikan test-nya peka); `apps/realtime/test/reconnect.test.ts › kompensasi latency end-to-end` |
| F-08 | Semua nickname di daftar uji kata kasar ditolak | Test moderasi (daftar kata, leetspeak, spasi, huruf berulang) | Lulus (otomatis) | `apps/realtime/test/moderation.test.ts › isNicknameAllowed: kata panjang …`, `› kata pendek …`, `› nama wajar (Scunthorpe problem)`; `apps/realtime/test/reconnect.test.ts › moderasi nickname › nama kasar -> NICKNAME_REJECTED …` |
| F-09 | Hasil tersimpan permanen di D1 lewat Queue; tampil di halaman riwayat | Test event game_ended, consumer idempotent, API riwayat; manual: game production sampai laporan di Riwayat | Lulus (otomatis); manual menunggu (langkah 3.5) | `apps/realtime/test/game-ended.test.ts › … game 3 soal selesai -> tepat satu event yang lolos skema …`; `apps/api/test/game-events.test.ts › consumer sorak-game-events › event valid -> 1 baris games …` dan `› pesan yang sama datang dua kali (at-least-once) …`; `apps/api/test/game-history.test.ts › GET /api/games/:id › laporan: …` |
| F-10 | Minimal 90% output lolos validasi skema pada set evaluasi; soal tidak terpakai sebelum host menyetujui | Test endpoint (Groq di-mock), test layar review; evaluasi `tools/ai-eval` dengan Groq sungguhan; manual: buat kuis dari materi di production | "Tidak terpakai sebelum disetujui": Lulus (otomatis). **≥ 90% lolos skema: menunggu evaluasi sungguhan** (langkah 2); dry-run hanya membuktikan alurnya | `apps/api/test/ai.test.ts › panggilan Groq › draf tidak masuk ke kuis mana pun`; `apps/web/test/ai-draft.test.ts › appendSelected dan roomLeft › hanya yang dicentang ditambahkan …`; `apps/api/test/ai-logic.test.ts › parseDrafts`; degradasi: `apps/api/test/ai.test.ts › akses dan validasi › tanpa GROQ_API_KEY: 503 AI_UNAVAILABLE …`, `› kuota harian per guru`. Hasil evaluasi: `tools/ai-eval/results/<tanggal>-gen-text-v1.md` (diisi setelah langkah 2). |

## 2. Evaluasi AI dengan Groq sungguhan (F-10)

Dijalankan Surya dengan key sendiri. Panduan lengkap ada di `tools/ai-eval/README.md`.

```powershell
$env:GROQ_API_KEY = "<key Groq>"
pnpm --filter ai-eval run eval
Remove-Item Env:GROQ_API_KEY
```

- Lamanya sekitar 15–25 menit, dan memakai sekitar 130.000 dari 200.000 token per hari. Jangan generate dari aplikasi selama skrip berjalan.
- Isi "Catatan Surya" pada 5 soal acak di file `.md` hasilnya, lalu commit `.md` dan `.json`.
- Tulis di sini: lolos skema ___% (target ≥ 90%), grounded ___%, latency p50 ___ / p95 ___, dan hasil materi injeksi ___.

Kalau lolos skema di bawah 90%: catat alasan gagal terbanyak dari ringkasan (misalnya `wrong_count` atau `invalid_schema` di path tertentu). Itu termasuk bug kritis untuk F-10.

## 3. Satu game penuh di production

Perlengkapan: laptop yang tersambung ke proyektor (layar guru), 3 HP (boleh HP teman, atau 1 HP + 2 jendela penyamaran di laptop lain), dan stopwatch HP. Lakukan **setelah deploy Hari 6** (urutan di `docs/spec/hari-6-ringkasan.md`).

### 3.1 Kuis dibuat dengan AI (F-01, F-10)
1. Masuk ke https://sorak.helpu.workers.dev, buka Kuis saya, lalu Buat kuis.
2. Isi judul. Tekan "Buat dari materi", tempel salah satu materi dari `tools/ai-eval/materials/` (atau materi pelajaranmu sendiri), pilih 10 soal, lalu tekan Buat draf soal.
3. Catat: lama menunggu ___ detik; jumlah draf yang ditandai "Bukti tidak ditemukan" ___.
4. Edit satu draf (ubah jawaban benarnya), buang satu draf (hapus centangnya), lalu tekan Tambahkan.
5. **Sebelum Simpan**, buka Kuis saya di tab lain: kuis atau soal AI belum ada di sana (soal belum terpakai sebelum disetujui).
6. Simpan. Buka kuisnya lagi: soal tetap ada dan bisa diedit.
7. Degradasi (opsional, di `pnpm dev` lokal tanpa `GROQ_API_KEY` di `.dev.vars`): dialog menampilkan "Fitur AI sedang tidak tersedia …", dan Tambah soal manual tetap bisa dipakai.

### 3.2 Join dan lobby (F-02, F-03, F-08)
1. Tekan Mainkan, pilih Klasik, lalu tampilkan PIN di proyektor.
2. HP 1: buka situsnya, masukkan PIN dan nama. Ukur waktu dari menekan Masuk sampai lobby tampil di HP: ___ detik (target < 5).
3. Ukur waktu dari lobby tampil di HP sampai nama muncul di proyektor: ___ (target < 1 detik).
4. HP 2: coba nama yang sama dengan HP 1 dengan huruf besar berbeda. Harus ditolak dengan pesan nama sudah dipakai.
5. HP 3: coba satu nama kasar dari daftar uji (misalnya dengan leetspeak). Harus ditolak, lalu masuk dengan nama wajar.

### 3.3 Game (F-04, F-05)
1. Mulai game. Di satu soal, tekan jawaban berkali-kali dengan cepat di HP 1: poin hanya dihitung sekali.
2. Di soal lain, jangan menjawab di HP 2: tetap 0 poin, dan kombonya putus.

### 3.4 Sinyal putus 30 detik (F-06)
1. Di tengah soal, tekan jawaban di HP 3, lalu langsung nyalakan mode pesawat selama 30 detik, lalu matikan.
2. HP 3 kembali ke game tanpa join ulang, skornya utuh, dan jawaban yang ditekan saat putus dihitung kalau dikirim ulang sebelum kunci dibuka.

### 3.5 Hasil (F-09)
1. Selesaikan semua soal sampai podium.
2. Buka Riwayat di laptop: game ini ada di urutan teratas. Buka laporannya: skor tiap pemain dan persen benar per soal tampil.

Catat hasil setiap langkah di kolom Hasil tabel bagian 1 (misalnya "Lulus (manual) 2026-10-27: 2,1 detik").

## 4. Bug yang ditemukan

Tingkat: **kritis** (MVP tidak bisa dipakai di kelas, atau data salah atau hilang), **mengganggu** (bisa dipakai, tapi guru atau siswa terhambat), **kosmetik** (tampilan saja).

| No | Tingkat | Fitur | Gejala | Langkah reproduksi | Status |
|---|---|---|---|---|---|
| 1 | | | | | |

Bug kritis diperbaiki di Hari 6, masing-masing dengan commit sendiri. Bug lain dicatat di sini untuk Hari 11.

## 5. Catatan untuk Hari 11

- F-01: soal bergambar belum ada (`image_url` selalu null sejak Hari 1). Acceptance criteria F-01 tidak memintanya, tetapi user story menyebut "gambar opsional".
- F-10: metrik produksi ada di tabel `ai_generations` (`status`, `grounded_count`, `prompt_version`, token, latency). Setelah pilot, bandingkan persen lolos dan persen grounded di produksi dengan hasil evaluasi offline.
- PRD menargetkan "soal AI yang disetujui guru tanpa edit minimal 70%". Angka ini bisa dihitung dari kolom `questions.origin` (`ai` dibanding `ai` + `ai_edited`) setelah pilot.
