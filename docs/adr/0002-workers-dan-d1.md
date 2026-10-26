# ADR 0002: D1 untuk data permanen

- Status: diterima
- Tanggal: 2026-10-08

## Konteks

Sorak butuh database untuk data yang harus bertahan: akun host, kuis, soal, dan hasil game (Data Model D1). Batasannya:

- Biaya Rp0. Semua harus muat di kuota gratis (lihat ADR 0001).
- Worker Free dibatasi 10 ms CPU per request. Menunggu database tidak dihitung sebagai CPU, tapi driver yang berat atau membuka koneksi TCP per request tetap memakan waktu dan kerumitan.
- Pengguna (guru dan siswa) ada di Indonesia, jadi database sebaiknya dekat Asia Pasifik.
- Proyek dikerjakan sendiri. Makin sedikit layanan dan kredensial yang harus diurus, makin baik.

Angka kuota gratis (dicek di dokumentasi penyedia, 2026-10-08):

| | D1 | Postgres gratisan + Hyperdrive | SQLite di Durable Object |
|---|---|---|---|
| Baca | 5 juta baris/hari | Hyperdrive: 100.000 query/hari | 5 juta baris/hari |
| Tulis | 100.000 baris/hari | (termasuk 100.000 query di atas) | 100.000 baris/hari |
| Penyimpanan | 5 GB total akun | Supabase 500 MB; Neon 1 GB/proyek | 5 GB total akun |
| Catatan | Sejak 2026-09-01 query gagal kalau kuota harian habis | Supabase: proyek dijeda setelah 1 minggu tidak aktif. Neon: compute tidur setelah 5 menit (cold start) | Satu objek = satu database terpisah |

Pengukuran Hari 1: menyimpan kuis 50 soal = 153 baris tulis (buat) atau 202 baris tulis (PUT).

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. D1 | Binding langsung (`env.DB`) tanpa driver, connection string, atau rahasia. Satu ekosistem dan satu dashboard dengan Worker. Lokasi bisa diarahkan ke APAC (`--location apac`). `batch()` atomik. Test memakai D1 asli lokal (pool-workers). | Kuota tulis 100.000/hari jadi batas keras. Dialek SQLite: tidak ada tipe kaya Postgres. Terikat ke Cloudflare. |
| B. Postgres gratisan (Supabase/Neon) lewat Hyperdrive | SQL Postgres yang lengkap; mudah pindah penyedia. | Butuh driver (`postgres`) sebagai dependensi baru dan bundle lebih besar. Ada dua akun dan rahasia (connection string). Supabase dijeda kalau sepi seminggu, padahal pemakaian kelas tidak rutin; Neon cold start setelah 5 menit. Hyperdrive 100.000 query/hari adalah batas tambahan. Test lokal butuh Postgres sendiri. |
| C. SQLite di Durable Object | Kuota sama dengan D1; sangat cepat karena data satu thread dengan kode. | Tiap objek punya database sendiri. Query lintas data ("semua kuis milik host ini", riwayat game per host, retensi 30 hari) butuh satu objek per host atau satu objek global yang jadi bottleneck. Migrasi skema harus dijalankan di setiap objek. |

## Keputusan

Pilihan A, D1. Data permanen Sorak relasional dan kecil (teks soal, ringkasan game), dan pola aksesnya adalah query per host dengan indeks, yang cocok untuk satu database SQLite bersama. D1 tidak menambah dependensi, rahasia, atau layanan kedua. D1 juga tidak tidur, sehingga guru yang membuka Sorak setelah liburan tidak menunggu database bangun.

Durable Object tetap dipakai untuk yang memang cocok baginya: state game live di GameRoom (ADR 0001), bukan data permanen.

## Konsekuensi

- Kuota tulis adalah anggaran yang harus dijaga: setiap jalur tulis mencatat `rows_written` di log, dan query baru dicek dengan `EXPLAIN QUERY PLAN` (aturan di `.claude/rules/api.md`).
- Hasil game masuk lewat Queue (consumer menulis dalam satu batch), bukan dari GameRoom langsung, supaya lonjakan akhir game tidak menulis per jawaban.
- Kalau kuota harian habis, query D1 gagal sampai 00:00 UTC (07:00 WIB). Risiko ini diterima selama pilot; kalau terjadi, angka `rows_written` di log menunjukkan jalur mana yang boros.
- Pindah ke Postgres nanti berarti menulis ulang query (dialek SQLite ke Postgres) dan lapisan akses di `apps/api/src/*.ts`. Karena semua query per tabel ada di satu modul, perubahannya terkumpul di sana.
