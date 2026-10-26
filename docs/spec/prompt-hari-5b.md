# Prompt Claude Code — Hari 5 Bagian B: tampilan dan gerak

**Persiapan:**
- Bagian A sudah di-commit.
- Ekstrak `sorak-design-boards.zip` ke `docs/design/boards/`, sehingga ada `docs/design/boards/README.md` dan file HTML-nya.
- `/clear`, lalu paste blok di bawah.

```text
Baca dulu:
- CLAUDE.md dan .claude/rules/web.md
- docs/spec/hari-5.md, Bagian B saja (Bagian A sudah selesai)
- docs/design/boards/README.md, lalu buka setiap board HTML (di browser kalau bisa, atau
  baca HTML dan CSS-nya)
- apps/web/src: styles.css (token), komponen, reducer, dan semua halaman
- packages/shared/src/server-messages.ts dan client-messages.ts
Board adalah acuan visual, bukan kode untuk disalin. Kalau board meminta data yang tidak ada
di protokol, ikuti tabel penyesuaian di spec B3. Kalau ada kasus yang tidak tercakup,
berhenti dan tanyakan.

Kerjakan per fase. Di akhir tiap fase:
- berhenti;
- laporkan hasil pnpm -r typecheck, pnpm -r test, dan ukuran gzip JS halaman siswa;
- beri daftar file yang berubah dan usulan commit message;
- sertakan screenshot sebelum dan sesudah untuk setiap layar yang berubah (kalau browser
  tersedia);
- tunggu saya commit sebelum lanjut.

FASE 0 — Rencana
- git status harus bersih.
- Untuk setiap board, tulis satu baris: komponen atau halaman mana yang berubah, dan data
  apa yang dipakai.
- Sebutkan bagian board yang datanya tidak ada dan belum disebut di B3.
- Maksimal 25 baris, lalu tunggu persetujuan.

FASE 1 — Komponen gerak (B2)
- FlapDigits, Tally, Countdown, RaiseIn, Leaderboard dengan FLIP, RiseIn, dan Logo animate.
- Fungsi murni FLIP dan Tally beserta test-nya. Semua komponen menghormati
  prefers-reduced-motion.
- Belum ada layar yang berubah di fase ini, kecuali halaman contoh sementara untuk
  dicek. Hapus halaman contoh itu sebelum fase selesai.

FASE 2 — Layar HP (HP-1 sampai HP-9) dan perubahan final (B4)
- Ikuti B3. Uji di lebar 360 px dan 390 px.

FASE 3 — Layar proyektor (Proyektor-1 sampai 5)
- Ikuti B3. Uji di 1280×720, dan pastikan teks terbaca dari jauh (soal minimal 48 px,
  pilihan 28 px).

FASE 4 — Halaman guru (Guru-1 sampai 4, Riwayat, Laporan)
- Ikuti B3. Tuliskan langkah uji manual B7, lalu tunggu laporan saya.

FASE 5 — Tombol Sorak (B5), hanya kalau saya bilang lanjut
- Sebelum mulai, tanyakan dulu apakah waktunya cukup. Kalau tidak, berhenti di Fase 4.

FASE 6 — Penutup
- Jangan deploy. Tuliskan urutan perintah: sorak-realtime dulu (final dan, kalau ada,
  sorak berubah), lalu build web dan deploy sorak.
- Ringkasan Bagian B:
  - apa yang dibuat;
  - konsep: FLIP, compositor-only animation (transform dan opacity), prefers-reduced-motion,
    leading-edge throttle (kalau B5);
  - trade-off;
  - daftar perbedaan dengan board yang sengaja dibiarkan.

Aturan tambahan:
- Tidak ada dependensi baru, termasuk library animasi.
- Tidak ada nilai warna atau ukuran baru di komponen; tambahkan ke token kalau perlu.
- Jangan menjalankan wrangler login, wrangler deploy, wrangler secret, atau perintah apa pun
  yang mengubah sumber daya di akun Cloudflare saya.
- Jangan membaca, mencetak, atau menyalin isi .dev.vars.
```
