# ADR 0007: Hasil game lewat Queue dengan consumer idempotent

- Status: diusulkan
- Tanggal: 2026-10-21

## Konteks

Setelah game selesai, hasilnya harus tersimpan permanen di D1 supaya guru bisa membuka riwayat dan rapor kelas: satu baris `games`, satu baris `game_players` per pemain, dan satu baris `game_question_stats` per soal. Game hidup di Durable Object GameRoom (Worker `sorak-realtime`), sedangkan D1 dan halaman guru ada di Worker `sorak`.

Angka dan batasan:
- **D1 Free:** 50 query per pemanggilan Worker, dan 100 parameter per query (dokumentasi D1 limits). Dokumentasinya tidak menjelaskan apakah statement di dalam `db.batch()` dihitung satu per satu; kami menganggap ya.
- **Event terbesar** (200 pemain, 50 soal) membutuhkan 27 query: cek host, 1 insert `games`, 19 insert `game_players` (11 baris per statement), dan 6 insert `game_question_stats` (9 baris per statement). Jumlah baris tulis diukur di test: 224 untuk 200 pemain/20 soal, 254 untuk 200 pemain/50 soal, cocok dengan anggaran Data Model bagian 7.
- **Queues di Workers Free** (sejak Februari 2026): 10.000 operasi per hari, retensi pesan paling lama 24 jam, pengiriman at-least-once, dan pesan maksimal 128 KB (128.000 byte). Event terbesar dengan huruf 3 byte bisa sampai 180 KB, jadi teks soal dan pilihan dipotong kalau lewat batas (sampai sekitar 111,5 KB).
- **GameRoom** sudah punya aturan: tidak memanggil D1 (`.claude/rules/realtime.md`), tulis storage sesedikit mungkin, dan podium tidak boleh menunggu pekerjaan lambat.
- **D1 bisa gagal sementara:** kuota harian habis sampai 00:00 UTC, atau database sibuk.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. GameRoom menulis langsung ke D1 saat game selesai | Paling sederhana: tanpa Queue, tanpa Worker kedua yang terlibat. Hasil langsung ada saat podium. | GameRoom (`sorak-realtime`) butuh binding D1, melanggar pemisahan dua Worker (ADR 0001). Podium menunggu 27 query. Kalau D1 gagal, GameRoom harus mengatur sendiri percobaan ulang dan menyimpan event di storage-nya. |
| B. GameRoom memanggil REST di Worker `sorak` | D1 tetap hanya di `sorak`. | Butuh endpoint internal dengan autentikasi antar-Worker. Kegagalan dan percobaan ulang tetap ditangani GameRoom sendiri. Tidak ada tempat untuk pesan yang terus gagal. |
| C. GameRoom mengirim event ke Queue, consumer di `sorak` menyimpan ke D1 | Podium tidak menunggu D1. D1 tetap hanya di `sorak`. Percobaan ulang dan DLQ disediakan Queue. Jalur simpan bisa di-deploy dan diuji terpisah. | Hasil muncul beberapa detik setelah podium (halaman rapor perlu menunggu). Pengiriman at-least-once menuntut consumer yang idempotent. Butuh dua queue yang dibuat manual, dan retensi DLQ di plan Free hanya 24 jam. |

## Keputusan

## Konsekuensi

**Yang menjadi lebih mudah**
- **GameRoom tidak tahu apa-apa soal D1.** GameRoom cukup menyusun `GameEndedEvent` (fungsi murni `buildGameEndedEvent`), memastikan ukurannya muat (`fitGameEvent`), lalu memanggil `send`. Jalur normal tetap satu `put` state dan satu `setAlarm`, sama dengan Hari 3, karena `gameEventSentAt` ikut di `put` yang sudah ada.
- **Consumer idempotent.** Semua insert memakai `INSERT OR IGNORE` dengan kunci dari event (`gameId`, `gameId + playerId`, `gameId + position`). Pesan yang datang dua kali menghasilkan data yang sama, dan kiriman kedua terukur menulis 0 baris. Satu `db.batch` adalah satu transaksi, jadi tidak ada game yang tersimpan setengah.
- **Kegagalan dibedakan jenisnya.**
  - *Poison message* (bentuknya rusak) dan host yang sudah dihapus langsung di-`ack` dan dicatat, karena dicoba ulang pun tidak akan berhasil.
  - Error D1 di-`retry` dengan jeda 60 × 2^(n−1) detik; setelah 5 percobaan, Queue memindahkan pesan ke DLQ `sorak-game-events-dlq`.

**Yang menjadi lebih sulit**
- **`max_batch_size: 1`.** Satu event terbesar sudah 27 query, jadi dua event dalam satu pemanggilan bisa melewati batas 50. Setiap game memakai satu pemanggilan consumer; dengan jumlah game per hari yang kecil, ini tidak masalah.
- **Kirim ulang di GameRoom.** Kalau `send` ke Queue melempar error, GameRoom mencoba lagi lewat alarm dengan jeda 30 s, 60 s, 2 menit, 5 menit, 15 menit, lalu tetap 30 menit. Setelah 24 jam, GameRoom mencatat `game_event_lost` dan membersihkan room. Selama mencoba ulang, room (dan PIN-nya) bertahan lebih lama dari masa podium biasa yang 10 menit.
- **Rapor dari podium bisa belum ada.** Halaman rapor yang dibuka langsung dari podium menampilkan "Laporan sedang disimpan…" dan mencoba lagi 3 kali dengan jeda 2 detik.

**Risiko yang sengaja diterima**
- **DLQ di plan Free hanya menyimpan pesan 24 jam.** Pesan yang masuk DLQ harus diperiksa dalam sehari; lewat dari itu, hasil game tersebut hilang.
- **Pesan di antrean utama juga hanya bertahan 24 jam.** Kalau consumer mati lebih dari sehari, event yang menunggu ikut hilang.
- **Event yang terlalu besar dipotong.** Teks soal (120 huruf) dan pilihan (30 huruf) di laporan bisa terpotong untuk kuis dengan aksara 2–3 byte per huruf; skor dan statistik tetap utuh.
- **Kirim ulang yang menyerah.** Kalau Queue tidak bisa dihubungi selama 24 jam, hasil game itu hilang dan hanya tercatat sebagai log `game_event_lost`.
