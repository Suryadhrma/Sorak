# Hari 5 Bagian B: ringkasan tampilan dan gerak

- Tanggal: 2026-10-23
- Status: selesai, sudah di-deploy, dan diuji live (room 409558, 3 HP virtual + proyektor guru).
- Patch berurutan: `fase-4-halaman-guru` → `4b` → `4c` → `4d` → `fase-5-sorak-dan-penghalusan`.

## 1. Urutan deploy

Jangan deploy saat ada game yang sedang berjalan: deploy `sorak-realtime` memutus semua WebSocket ke GameRoom.

```powershell
pnpm -r typecheck
pnpm -r test

# 1) GameRoom dulu: menerima react "sorak", mengirim cheer / cheer_total, dan final dengan correctCount.
pnpm exec wrangler deploy -c apps/realtime/wrangler.jsonc

# 2) Build web, lalu Worker "sorak" (menyajikan apps/web/dist + REST).
pnpm --filter @sorak/web build
pnpm exec wrangler deploy -c apps/api/wrangler.jsonc

# Cek
pnpm exec wrangler deployments list --name sorak-realtime
pnpm exec wrangler deployments list --name sorak
```

- Tidak ada migrasi D1 dan tidak ada secret baru di Bagian B.
- Urutan realtime → web aman, karena semua perubahan protokol kompatibel (field opsional, nilai enum baru, pesan baru yang diabaikan klien lama). Web lama yang menerima `cheer` dari GameRoom baru hanya mengabaikannya.
- Rollback: `pnpm exec wrangler rollback --name sorak` (web/REST) atau `--name sorak-realtime` (GameRoom).

## 2. Yang dibuat

**Komponen gerak (B2)**, di `apps/web/src/motion/`:
- `FlapDigits`: ubin angka bergaris belah, hanya digit yang berubah berputar masuk (500 ms, jeda 60 ms; `delayOffset` untuk PIN 3 + 3).
- `Tally`: turus SVG, hanya garis baru yang digambar, berurutan 60 ms per garis.
- `Countdown`: angka berganti per detik dengan gulung pendek, batang `scaleX`, merah muda di 5 detik terakhir.
- `RaiseIn` (kartu jawaban), `RiseIn` (batang sebaran, balok podium; juara 1 paling akhir).
- `Leaderboard`: papan skor dengan FLIP, baris yang naik berbingkai kapur.
- `Logo animate`: tangan terangkat dan garis sorak, sekali.

**Layar HP (HP-1 sampai HP-9)**: keypad PIN, form nama, lobby dengan tombol Sorak, soal, terkirim, benar, salah / tidak menjawab, rapor akhir dengan "Jawaban benar X dari Y", terputus.

**Layar proyektor (Proyektor-1 sampai 5)**: lobby dengan aliran sorak dan saklarnya, soal, sebaran, papan skor (chip "+poin", kolom kanan dari data host), podium dengan konfeti turus dan "Lihat rapor kelas". Ukuran teks dihitung untuk 1280x720 sampai 1920x1080.

**Halaman guru (Guru-1 sampai 4, Riwayat, Laporan)**: kertas bergaris buku dengan garis margin yang ikut ke tengah di monitor lebar, kepala bersama (Kuis saya, Riwayat, Keluar), editor dengan daftar soal dan pil "Tandai benar", dialog Mainkan, Simpan yang kembali ke Kuis saya dengan pesan dan sorotan baris.

**Protokol (B4, B5)**: `final` + `correctCount`, `questionCount` (opsional); `REACTIONS` + `"sorak"`; `cheer` ke host, `cheer_total` ke pemain; `reaction` lama dihapus; `react` hanya sah di lobby.

**Sorak di GameRoom (B5)**: ember sorak per socket (5, isi ulang 2/detik, kelebihan dibuang tanpa menutup socket), total dan penyorak terakhir hanya di memori, leading-edge throttle 300 ms (host) dan 2 detik (pemain) tanpa timer.

**Penghalusan**: tombol "turun ke alasnya" saat ditekan, dialog dan layar muncul halus, baris yang dihapus memudar, papan peringkat di panel login bolak-balik.

## 3. Konsep

**FLIP (First, Last, Invert, Play).** Papan skor tidak menghitung ulang posisi setiap frame. Posisi lama (First) diambil dari leaderboard reveal sebelumnya, React merender urutan baru (Last), setiap baris digeser kembali ke posisi lamanya dengan `transform` (Invert), lalu transform dilepas sehingga baris meluncur 600 ms ke tempat barunya (Play). Bagian murninya (`leaderboardMoves`: berapa baris tiap pemain bergeser, siapa yang naik) diuji tanpa browser. Catatan: Play memakai CSS transition, bukan `element.animate`; hasilnya sama dan tetap hanya `transform`.

**Compositor-only animation.** Browser menggambar halaman dalam tiga tahap: hitung tata letak (layout), gambar piksel (paint), gabungkan lapisan (composite). `transform` dan `opacity` hanya menyentuh tahap terakhir, yang dikerjakan GPU, jadi tetap lancar di Android RAM 2 GB. Karena itu batang sebaran memakai `scaleX`, bukan `width`; garis tenaga sorak tumbuh dengan `scaleY`; sorotan baris kuis memakai lapisan `::before` yang hanya berubah opacity; efek "tulis" di board (clip-path) diganti geser + pudar.

**prefers-reduced-motion.** Pengaturan OS "Kurangi gerakan". Gaya dasar selalu keadaan akhir; animasi hanya dipasang di dalam `@media (prefers-reduced-motion: no-preference)`. Untuk gerak berbasis JS (FLIP, getar tombol Sorak saat tenaga habis) dicek `matchMedia` dulu. Label sorak yang beterbangan disembunyikan; angkanya tetap diperbarui.

**Leading-edge throttle.** Sorak pertama langsung dikirim, sorak berikutnya dalam jeda (300 ms ke host, 2 detik ke pemain) hanya dihitung dan ikut terbawa di kiriman berikutnya. Tanpa `setTimeout`, karena GameRoom harus bisa hibernasi. Kekurangannya: sorak terakhir dalam satu rentetan bisa tertahan sampai ada sorak lagi. Untuk dekorasi itu diterima.

**Token bucket (dua ember).** Ember umum (10 pesan/detik) menutup socket yang membanjiri server; ember sorak (5, isi ulang 2/detik) hanya membuang kelebihan sorak. Batas tenaga di HP (5 garis, isi ulang 0,6 detik) sedikit lebih ketat dari ember sorak, jadi HP yang jujur tidak pernah kena buang (uji live: 3 HP x 10 detik = 58 sorak, semua terhitung).

## 4. Trade-off

- **Sorak hanya di memori.** Hemat kuota tulis storage; total kembali 0 kalau GameRoom hibernasi, dan proyektor yang di-refresh mulai dari 0 sampai sorak berikutnya.
- **Tidak ada library animasi.** Bundle siswa 124,3 KB gzip (batas 200 KB); konsekuensinya FLIP, turus, dan tenaga sorak ditulis sendiri dan diuji.
- **Papan login berulang (bolak-balik).** Menyimpang dari aturan "animasi masuk sekali", atas permintaan pemilik produk; hanya untuk panel hiasan, tetap mati dengan reduced motion.
- **Simpan kembali ke Kuis saya.** Lebih jelas untuk guru, tapi guru yang ingin lanjut mengedit perlu klik Ubah lagi.
- **Test integrasi sorak memakai jam asli.** Fake `Date` di test harness Workers menukar urutan pesan WebSocket; hitungan jeda presisi diuji di test murni (`addCheer`, ember sorak).
- **Ukuran teks proyektor berbasis lebar layar (vw) dengan batas atas untuk 1080p.** Proyektor 4:3 atau sangat tinggi tidak dioptimalkan khusus.

## 5. Perbedaan dengan board yang sengaja dibiarkan

| Board | Perbedaan | Alasan |
|---|---|---|
| HP-5 | Tanpa "18 / 27 sudah menjawab"; diganti turus menunggu | Pemain tidak menerima `answer_count` (spec B3) |
| HP-6 | "Kombo N" tanpa angka bonus | Rumus bonus ada di server (B3) |
| HP-7, Proyektor-3 | Tanpa blok penjelasan dan "paling cepat benar" | `explanation` belum ada di protokol (B6) |
| Proyektor-4 | Tanpa "Kombo terpanjang"; ada "Naik paling jauh", "Poin terbesar", "X dari Y benar" | Data yang bisa dihitung host (B3) |
| Proyektor-1 | Alamat dari `location.host` | B3 |
| Guru-1 | Tombol Google tanpa logo Google | B3 |
| Guru-2 | "diubah <tanggal>", bukan "terakhir dimainkan" | Belum ada datanya (B3/B6) |
| Guru-2 | Judul baris muncul geser + pudar, bukan efek tulis (clip-path) | Hanya transform/opacity (B2) |
| Guru-3 | Semua soal berurutan (daftar kiri = lompat ke soal), waktu menjawab tetap kotak angka, tanpa tombol Mainkan, tanpa teks bantuan penjelasan | "Restyle saja"; alur penjelasan belum ada (B6) |
| Guru-3 | Simpan kembali ke Kuis saya, bukan status "Tersimpan" di editor | Keputusan pemilik produk |
| Guru-4 | "N soal", tanpa "sekitar 6 menit"; tanpa ikon turus di kartu mode | `QuizSummary` tidak membawa waktu per soal |
| Panel login | Papan bertukar bolak-balik terus | Permintaan pemilik produk |

## 6. Untuk Notion (di luar cakupan Hari 5, B6)

- `explanation` end-to-end: editor → `QuizSnapshot` → `reveal` / `result` → layar HP-7 dan Proyektor-3.
- "Terakhir dimainkan" di Kuis saya.
- Rapor Sorak lengkap dan kartu yang bisa diunduh (Hari 8).
- Peta Miskonsepsi dengan AI.
- Dokumen Protokol: tempel isi `catatan-protokol-sorak.md`.
