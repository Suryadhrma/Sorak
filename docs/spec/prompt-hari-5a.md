# Prompt Claude Code — Hari 5 Bagian A: hasil game tersimpan

**Persiapan:**
- Commit semua perubahan Hari 4.
- Taruh `hari-5.md` di `docs/spec/`.
- Buat dua queue di akun Cloudflare-mu (spec bagian A1). Perintahnya kamu jalankan sendiri.
- `/clear`, lalu paste blok di bawah.

```text
Baca dulu:
- CLAUDE.md dan semua file di .claude/rules/
- docs/spec/hari-5.md, Bagian A saja (Bagian B dikerjakan di sesi terpisah)
- packages/shared/src, terutama events.ts dan room-storage.ts
- apps/realtime/src (handler ended dan alarm), apps/api/src, apps/api/migrations/0001_init.sql
- halaman web /quizzes dan /host/:pin (podium)
Kode Hari 1–4 adalah acuan utama: kalau spec menyebut nama yang berbeda dengan kode, ikuti
kode. Kalau spec bertentangan dengan kode atau dokumentasi Cloudflare, berhenti dan tanyakan.

Kerjakan per fase. Di akhir tiap fase:
- berhenti;
- laporkan hasil pnpm -r typecheck dan pnpm -r test;
- beri daftar file yang berubah dan usulan commit message;
- jelaskan konsep baru dalam Bahasa Indonesia sederhana;
- tunggu saya commit sebelum lanjut.

FASE 0 — Rencana
- git status harus bersih.
- Cek di dokumentasi Cloudflare (sebutkan sumbernya):
  - konfigurasi producer/consumer Queues, dead_letter_queue, dan retry_delay di wrangler.jsonc;
  - batas D1 Free: 50 query per pemanggilan dan 100 parameter per query, termasuk apakah
    statement di dalam db.batch() dihitung satu per satu;
  - cara menguji queue() dan scheduled() di vitest-pool-workers.
- Hitung ulang jumlah statement per event dari kolom sebenarnya di 0001_init.sql.
- Tulis rencana maksimal 10 baris, lalu tunggu persetujuan.

FASE 1 — Shared dan event
- Konstanta, RoomState (gameEventSentAt, gameEventAttempts), dan skema REST riwayat (A2).
- game-event.ts beserta test-nya, termasuk ukuran kasus terburuk (A3).

FASE 2 — GameRoom mengirim event
- Binding producer, kirim saat ended, retry dengan backoff lewat alarm, dan game_event_lost
  (A3). Skeleton-first.
- Test GameRoom dari A3. Laporkan jumlah tulis storage di jalur normal (harus sama dengan
  Hari 3) dan di jalur retry.

FASE 3 — Consumer dan cron
- Consumer di apps/api (A4) dan cron (A5), beserta test-nya.
- Laporkan rowsWritten per event dari test, lalu bandingkan dengan anggaran Data Model
  bagian 7.

FASE 4 — REST dan web
- GET /api/games dan /api/games/:id (A6), halaman Riwayat dan Laporan, serta tombol
  "Lihat rapor kelas" di podium (A7).
- Selesai kalau pnpm --filter web build berhasil. Laporkan ukuran gzip JS halaman siswa.
- Tuliskan langkah uji manual A8, lalu tunggu laporan saya.

FASE 5 — Penutup
- Draf ADR baru: "Hasil game lewat Queue dengan consumer idempotent". Isinya: kenapa
  Queue, bukan tulis D1 langsung dari GameRoom; at-least-once dan INSERT OR IGNORE;
  max_batch_size 1 karena batas query D1; DLQ dengan retensi 24 jam di plan Free; dan
  backoff kirim ulang di GameRoom. Bagian Keputusan hanya judul.
- Jangan deploy. Tuliskan urutan perintah untuk saya:
  - queue sudah dibuat;
  - deploy sorak-realtime (producer) dulu, lalu build web dan deploy sorak (consumer dan
    cron).
  - Jelaskan apa yang terjadi pada event kalau consumer belum ter-deploy saat game selesai.
- Ringkasan Bagian A:
  - apa yang dibuat;
  - konsep: at-least-once, idempotent consumer, poison message, dead letter queue, retry
    with backoff, keyset pagination, ON DELETE CASCADE;
  - trade-off.

Aturan tambahan:
- Tidak ada dependensi baru tanpa izin.
- Jangan menjalankan wrangler login, wrangler deploy, wrangler secret, wrangler queues,
  atau perintah apa pun yang mengubah sumber daya di akun Cloudflare saya.
- Jangan membaca, mencetak, atau menyalin isi .dev.vars.
```
