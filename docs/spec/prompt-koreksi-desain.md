# Prompt Claude Code — Koreksi desain sebelum Hari 4

**Kapan dipakai:** sekali, setelah Hari 3 di-commit dan sebelum Hari 4.

**Tujuannya:** fondasi desain di repo diganti ke arah "Papan skor kelas" yang sudah disetujui di kanvas desain. Isinya design token, kartu jawaban A–D, font, dan logo. Dengan begitu layar baru di Hari 4 langsung memakai token yang benar.

**Batasnya:** tata letak lengkap dan motion graphic tetap dikerjakan di Hari 5. Prompt ini hanya mengganti fondasinya, supaya Hari 4 tetap fokus ke koneksi.

```text
Baca dulu:
- CLAUDE.md
- .claude/rules/web.md
- file design token yang dipakai web saat ini, beserta semua komponen yang mengimpornya
- komponen tombol jawaban di /play/:pin, serta tampilan soal dan reveal di /host/:pin

Tugas ini mengganti fondasi desain. Bukan polesan layar; polesan dikerjakan di Hari 5.

Arah desain yang sudah disetujui: "Papan skor kelas". Motifnya: papan tulis hijau, kapur
kuning, turus (hitungan garis), papan skor dengan angka yang berbalik (split-flap), dan
papan regu Cerdas Cermat. Yang dihindari: bentuk segitiga/belah ketupat/lingkaran/persegi
ala Kahoot, warna ungu, maskot, emoji sebagai ikon, dan label huruf kapital semua.

FASE 0 — Rencana
- git status harus bersih.
- Tulis rencana maksimal 10 baris: file token, komponen yang berubah, dan cara memuat font.
  Tunggu persetujuan.

FASE 1 — Token dan font
1. Ganti isi file design token dengan nilai di bawah. Nama token boleh mengikuti konvensi
   yang sudah ada di repo, asal maknanya sama.

   Warna dasar:
   papan #14261f        latar HP siswa (tema gelap)
   papan-2 #1c3329      panel di atas papan
   papan-garis #2c4337  garis dan slot kosong di atas papan
   kapur #f2b705        aksen utama, tombol utama
   kapur-tekan #b88a00  bayangan bawah tombol kapur
   kapur-putih #eef3ee  teks utama di atas papan
   kapur-redup #a9bab0  teks sekunder di atas papan
   kertas #f5f7f4       latar layar proyektor dan halaman guru (tema terang)
   kertas-putih #ffffff permukaan input dan panel di atas kertas
   garis #d5ddd7        border di atas kertas
   tinta #15211b        teks utama di atas kertas
   tinta-redup #4c5b53  teks sekunder di atas kertas
   benar #0f6d8c        jawaban benar
   benar-gelap #0a4f66  panel di atas warna benar
   bahaya #a3262c       teks aksi berbahaya (Hapus, Keluarkan) di atas kertas
   waktu-kritis #ff8b7e angka hitung mundur 5 detik terakhir di atas papan
   buku-garis #dde6ee   garis buku tulis (halaman guru)
   buku-margin #e7a9ac  garis margin buku tulis (halaman guru)

   Kartu jawaban (warna seragam sekolah). Warna + HURUF, bukan bentuk:
   A: latar #c0262d, teks #ffffff, lipatan #9c1d23
   B: latar #1f2d5c, teks #ffffff, lipatan #141e40, cincin #4a5a8c (hanya di atas papan,
      supaya tepinya terlihat di latar gelap)
   C: latar #8e979c, teks #15211b, lipatan #737c81
   D: latar #d9c48c, teks #15211b, lipatan #bfa86c

   Radius: 8 (kecil), 14 (kartu jawaban), 16 (panel), 24 (tombol besar), 32 (tombol Sorak).
   Bayangan "alas": 0 4px 0 #08120e di atas papan, 0 4px 0 tinta di atas kertas.
   Bayangan "lipatan" kartu jawaban: inset 0 10px 0 <warna lipatan>.

   Gerak (dipakai Hari 5, cukup didefinisikan sekarang):
   balik 500ms cubic-bezier(.3,1.5,.6,1), jeda 60ms per digit
   turus 300ms ease-out per garis
   angkat 450ms cubic-bezier(.3,1.35,.6,1), jeda 70ms per kartu
   geser 600ms cubic-bezier(.5,0,.2,1)
   naik 700ms cubic-bezier(.2,.8,.2,1)

2. Font:
   - Big Shoulders Display 800 untuk angka besar (PIN, hitung mundur, skor, peringkat,
     huruf A–D di kartu jawaban) dan judul pendek.
   - Plus Jakarta Sans 500/700/800 untuk semua teks lain.
   - Saya izinkan dependensi @fontsource/big-shoulders-display dan
     @fontsource/plus-jakarta-sans. Keduanya hanya berisi file font dan CSS, tanpa
     JavaScript.
   - Impor hanya subset latin untuk bobot di atas, dengan font-display: swap.
   - Jangan memuat dari Google Fonts, karena request ke domain lain memperlambat HP
     bersinyal jelek.
   - Laporkan total ukuran file font yang dimuat halaman siswa.

FASE 2 — Komponen
1. Tombol jawaban di HP siswa menjadi "kartu regu":
   - kotak berwarna sesuai huruf, dengan lipatan di tepi atas (bayangan inset);
   - huruf besar (Big Shoulders 800) di kiri atas, teks pilihan di kiri bawah;
   - tata letak grid 2x2 untuk 4 pilihan, dan 1 kolom untuk 2 pilihan.
   - Hapus semua komponen dan aset bentuk (segitiga dan seterusnya).
   - Tetap <button> dengan aria-label "Pilihan A: <teks>".
2. Di layar proyektor (soal dan reveal):
   - pilihan memakai kartu yang sama dalam satu baris berisi 4 kolom;
   - batang sebaran memakai ubin huruf kecil berwarna yang sama;
   - pilihan benar diberi cincin warna "benar", dan pilihan lain diredupkan.
3. Komponen Logo (SVG inline). Dipakai di header halaman dan favicon:

   <svg viewBox="0 0 120 120" role="img" aria-label="Sorak">
     <g transform="rotate(-8 64 64)" fill="currentColor">
       <rect x="36" y="22" width="13" height="50" rx="6.5"/>
       <rect x="52" y="10" width="13" height="62" rx="6.5"/>
       <rect x="68" y="14" width="13" height="58" rx="6.5"/>
       <rect x="84" y="26" width="13" height="46" rx="6.5"/>
       <path d="M36 56 H97 V80 C97 92 89 99 78 99 H55 C44 99 36 92 36 81 Z"/>
       <line x1="42" y1="80" x2="23" y2="58" stroke="currentColor" stroke-width="13"
             stroke-linecap="round"/>
       <rect x="47" y="103" width="40" height="15" rx="4" fill="var(--manset, currentColor)"/>
     </g>
   </svg>

   - Di atas papan: tangan kapur, manset kapur-putih.
   - Di atas kertas atau kapur: tangan dan manset tinta.
   - Wordmark "sorak" memakai Big Shoulders 800 huruf kecil, di sebelah kanan tangan.
   - Favicon dan ikon 28 px atau lebih kecil memakai versi tebal:
     rect x31 y24 w16 h50 rx8; x48 y12 w15 h62; x64 y18 w15 h56; x80 y32 w14 h42;
     path telapak dengan x mulai 31 sampai 94; line stroke-width 16.
4. Tema:
   - HP siswa memakai tema papan (gelap).
   - Layar proyektor, login, dan halaman guru memakai tema kertas (terang).

FASE 3 — Aturan dan penutup
1. Perbarui .claude/rules/web.md, di bagian "Dua layar, dua kebutuhan":
   - Ganti "Tombol jawaban besar, dibedakan dengan bentuk dan warna (bukan warna saja)"
     menjadi "Tombol jawaban berupa kartu regu: huruf A–D besar dan warna seragam per
     huruf. Huruf yang membedakan pilihan, bukan warna saja."
   - Tambahkan: "Arah desain 'Papan skor kelas'. HP memakai tema papan (gelap); proyektor
     dan halaman guru memakai tema kertas (terang)."
2. Pastikan:
   - kontras teks minimal 4.5:1 (3:1 untuk teks besar di atas 24 px) di semua kombinasi
     token yang dipakai;
   - test reducer dan komponen yang ada masih lulus;
   - pnpm --filter web build berhasil, dengan ukuran gzip JS halaman siswa tetap di bawah
     200 KB.
3. Ringkasan: apa yang diganti, ukuran font, hasil cek kontras, dan usulan commit message
   (misalnya "feat(web): switch design tokens to papan skor kelas").

Aturan tambahan:
- Jangan mengubah logika koneksi, reducer, atau GameRoom.
- Tidak ada dependensi lain selain dua paket font di atas.
```
Sekalian perbaiki 3 cacat tampilan dari laporan Hari 3:
1. Teks pilihan terpotong di tengah kata di layar reveal guru ("Kalimant/an"): ganti
   overflow-wrap: anywhere menjadi break-word di .answer-text, dan persempit kolom jumlah.
2. Empat pilihan di layar guru tersusun 3 + 1: jadikan satu baris 4 kolom sesuai
   FASE 2 poin 2 di atas.
3. Tombol Batalkan dan Akhiri game jauh lebih kecil dari Mulai/Lanjut: samakan tingginya.
   Bedakan lewat gaya (garis tepi, teks warna bahaya), bukan lewat ukuran.