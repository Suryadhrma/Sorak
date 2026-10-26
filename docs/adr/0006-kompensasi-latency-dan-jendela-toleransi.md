# ADR 0006: Kompensasi latency dan jendela toleransi

- Status: diusulkan
- Tanggal: 2026-10-09

## Konteks

Sorak menjanjikan kuis yang adil untuk siswa bersinyal jelek. Sampai Hari 3, waktu jawab dihitung dari jam server saja: `t = min(tServer, T)`, dengan `tServer` = lama sejak soal dikirim sampai jawaban tiba. Artinya jeda sinyal ikut dihitung sebagai waktu berpikir. Siswa dengan jeda satu arah 800 ms kehilangan sekitar 1,6 detik per soal dibanding siswa dengan jeda 50 ms, padahal waktu reaksinya sama.

Angka dan batasan:
- Mode Klasik: poin = 1000 × (1 − t / 2T). Pada T = 10 detik, setiap 100 ms bernilai 5 poin.
- Simulasi `fairness.test.ts` (5 soal, reaksi identik 3.000 ms, jeda 50 ms vs 800 ms, jitter ±100 ms, seed tetap): dengan rumus Hari 3 selisih total skor **di atas 5%**.
- Server tidak bisa melihat jam HP. Satu-satunya yang bisa diukur server adalah RTT: soal dikirim, lalu `ack` dari HP tiba (dua-duanya jam server).
- HP bisa dimodifikasi. Apa pun yang dikirim HP, termasuk klaim lama berpikir `elapsedMs`, harus dianggap bisa dipalsukan.
- GameRoom tidak boleh menulis storage per jawaban (aturan domain 4), jadi estimasi latency harus hidup di attachment socket.
- CPU Worker 10 ms per request: perhitungannya harus O(1) per pesan.

Masalah kedua yang terkait: jawaban yang tiba sedikit setelah batas waktu karena sinyal, bukan karena siswa lambat. Sejak Hari 3 ada tahap `grace` selama `GRACE_MS` (2.000 ms) setelah batas waktu. Hari 4 menambahkan reconnect otomatis dan antrean jawaban di HP, sehingga jawaban yang ditekan saat offline bisa tiba di tahap grace.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. Jam server saja (`t = min(tServer, T)`, rumus Hari 3) | Tidak bisa dicurangi; paling sederhana; tidak perlu `ack`. | Tidak adil untuk sinyal jelek: selisih skor di atas 5% pada simulasi 50 vs 800 ms. Bertentangan dengan janji produk. |
| B. Percaya klien sepenuhnya (`t = elapsedMs` dari HP) | Paling adil untuk pemain jujur: jeda sinyal hilang sepenuhnya dari perhitungan. | Bisa dicurangi tanpa batas: HP yang dimodifikasi mengklaim `elapsedMs = 0` dan selalu mendapat poin maksimal. |
| C. Clamp dengan EWMA (*trust but verify*): `t = clamp(elapsedMs, tServer − 2d − ε, tServer)`, `d` = EWMA dari RTT/2 dengan α 0,3, dibatasi 1.500 ms, ε = 150 ms | Klaim HP dipakai selama masih masuk akal secara fisik. Simulasi 50 vs 800 ms: selisih **di bawah 5%**, dan uji end-to-end memberi 988 vs 988 poin. Klaim palsu hanya untung sebesar ε, sekitar 7 poin per soal (<1%). Satu lonjakan sinyal tidak merusak estimasi karena EWMA. | Perlu pesan `ack` per soal dan dua field di attachment (`latencyMs`, `ackedQ`). Pemain bisa menunda `ack` untuk membesarkan `d`, tapi dibatasi `MAX_ONE_WAY_LATENCY_MS`. Pemain tanpa sampel `ack` diperlakukan `d = 0`. |

## Keputusan

## Konsekuensi

**Yang menjadi lebih mudah**
- Janji "adil untuk sinyal jelek" punya bukti otomatis. `fairness.test.ts` gagal kalau kompensasinya rusak, dan juga gagal kalau test-nya tidak lagi bisa membedakan rumus adil dari rumus Hari 3 (assert pembanding).
- Semua logikanya fungsi murni di `latency.ts` (`updateLatency`, `compensateAnswerTime`), jadi bisa diuji dan dijelaskan tanpa WebSocket.

**Yang menjadi lebih sulit**
- Protokol bertambah satu pesan (`ack`). Setiap klien wajib mengirimnya begitu soal diterima, sebelum menampilkan soal.
- Jawaban yang tiba di tahap grace lewat rumus yang sama. Karena `tServer` sudah melewati T, `t` hampir selalu T, jadi jawabannya dinilai benar atau salah tetapi poin kecepatannya paling kecil.

**Risiko yang sengaja diterima**
- **Celah ε.** Pemain yang mengklaim `elapsedMs = 0` mendapat paling banyak 150 ms lebih cepat dari kenyataan: sekitar 7 poin per soal di mode Klasik (<1%). ε tidak dikecilkan karena ε yang lebih kecil merugikan pemain jujur yang sinyalnya naik-turun (jitter): klaim jujur mereka akan ikut terpotong oleh batas bawah.
- **Celah menunda `ack`.** Pemain bisa sengaja menunda `ack` supaya `d` terlihat besar dan batas bawah clamp turun. Celah ini dibatasi `MAX_ONE_WAY_LATENCY_MS` (1.500 ms), dan EWMA membuat `d` naik bertahap, bukan sekaligus.
- **Poin konservatif untuk jawaban yang sempat offline.** Jawaban dari antrean HP yang dikirim setelah tersambung lagi punya `tServer` besar, jadi batas bawah clamp juga besar dan poin kecepatannya kecil. Server tidak bisa memverifikasi klaim waktu dari HP yang tidak terlihat selama offline, jadi lebih aman sedikit merugikan pemain jujur daripada membuka celah.
- **Soal pertama setelah resume di tengah soal.** HP yang tersambung lagi menerima soal lewat snapshot di `welcome`, bukan lewat broadcast, dan tidak mengirim `ack` untuk snapshot. Untuk satu soal itu, `latencyMs` bisa masih null (`d = 0`, tanpa kelonggaran). Estimasi pulih di soal berikutnya. Tidak ada field atau tulis storage tambahan untuk menutup kasus ini.
- Uji manual di jaringan sungguhan (throttling "Slow 4G" atau latency 800 ms) belum dilakukan; angka di atas berasal dari simulasi dan uji end-to-end di `vitest-pool-workers`.
