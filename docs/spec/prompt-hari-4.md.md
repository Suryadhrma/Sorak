# Prompt Claude Code — Hari 4: tahan sinyal jelek

**Persiapan:**
- Kalau kamu menjalankan prompt koreksi desain (`prompt-koreksi-desain.md`), selesaikan dan commit dulu.
- Taruh `hari-4.md` di `docs/spec/hari-4.md`, lalu buka Claude Code di root repo.

```text
Baca dulu:
- CLAUDE.md
- docs/spec/hari-4.md, ditambah bagian 1 dari docs/spec/hari-3.md
- .claude/rules/realtime.md dan .claude/rules/web.md
- seluruh packages/shared/src
- apps/realtime/src beserta test-nya
- modul koneksi web (socket.ts), reducer, dan halaman /play/:pin dan /host/:pin
docs/spec/hari-4.md adalah spesifikasi lengkap tugas hari ini. Kode Hari 1–3 adalah acuan
utama: kalau spec menyebut nama yang berbeda dengan kode, ikuti kode. Kalau spec
bertentangan dengan perilaku kode atau dokumentasi Cloudflare, berhenti dan tanyakan.

Kerjakan per fase. Di akhir tiap fase:
- berhenti;
- laporkan hasil pnpm -r typecheck dan pnpm -r test;
- beri daftar file yang berubah dan usulan commit message;
- jelaskan konsep baru dalam Bahasa Indonesia sederhana;
- tunggu saya commit sebelum lanjut.

FASE 0 — Rencana
- git status harus bersih.
- Tulis rencana maksimal 10 baris. Sebutkan:
  - nama di spec yang berbeda dengan kode;
  - field PlayerScore apa yang sudah ada untuk hasil soal terakhir (spec bagian 2);
  - cara webSocketClose saat ini membedakan socket yang ditutup server dan yang putus
    sendiri.
- Tunggu persetujuan.

FASE 1 — Logika murni
- Perubahan packages/shared (spec bagian 2).
- latency.ts, fairness.test.ts, dan moderation.ts beserta blocked-words.ts (spec bagian 3).
- Tulis test lebih dulu dari implementasi. Di laporan, tampilkan:
  - angka selisih skor dari fairness.test.ts, dengan dan tanpa kompensasi;
  - nama wajar yang ikut tertolak, kalau ada.

FASE 2 — GameRoom
- Spec bagian 4, 5, dan 6. Skeleton-first: handler ack, resume per tahap, kick per tahap,
  dan jalur "replaced" di webSocketClose dibuat dengan throw "not implemented" dulu, lalu
  diisi satu per satu.
- Test GameRoom dari spec bagian 8.
- Laporkan jumlah tulis storage untuk resume (target 0) dan kick di tengah game.

FASE 3 — Web
- Spec bagian 7: reconnect dengan backoff + jitter, ack, outbox jawaban dengan
  decideQueuedAnswer, layar terputus, close code, penanda connected, dan kick di layar
  guru.
- Ikuti design token yang sudah ada di repo. Jangan menambah warna atau ukuran baru di
  komponen.
- Selesai kalau pnpm --filter web build berhasil. Laporkan ukuran gzip JS halaman siswa.
- Tuliskan langkah uji manual dari spec bagian 9, lalu tunggu laporan saya.

FASE 4 — Penutup
- Draf ADR "Kompensasi latency dan jendela toleransi" (spec bagian 10). Bagian Keputusan
  hanya judul, karena saya yang menulisnya.
- Jangan deploy. Tuliskan urutan perintah untuk saya: deploy sorak-realtime dulu
  (GameRoom berubah), lalu build web dan deploy sorak. Sebutkan juga bahwa deploy
  memutus semua socket, dan sejak hari ini HP akan tersambung ulang sendiri.
- Tutup dengan ringkasan Hari 4:
  - apa yang dibuat;
  - konsep yang dipakai: RTT, EWMA, clamp / trust but verify, snapshot vs replay,
    exponential backoff with jitter, thundering herd, outbox, idempotent, Scunthorpe
    problem;
  - trade-off: poin konservatif untuk jawaban yang sempat offline, celah menunda ack
    yang dibatasi 1.500 ms, kick di lobby tanpa daftar hitam.

Aturan tambahan:
- Tidak ada dependensi baru tanpa izin.
- Jangan menjalankan wrangler login, wrangler deploy, wrangler secret, atau perintah apa pun
  yang mengubah sumber daya di akun Cloudflare saya.
- Jangan membaca, mencetak, atau menyalin isi .dev.vars.
```
