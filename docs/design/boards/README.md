# Board desain Sorak: "Papan skor kelas"

Ekspor dari kanvas desain (claude.ai). Setiap file HTML berdiri sendiri: buka di browser untuk melihat tampilan dan animasinya.

Cara membaca:
- File ini **acuan visual**, bukan kode untuk disalin. Implementasi tetap memakai komponen React, design token di styles.css, dan aturan di .claude/rules/web.md.
- Animasi di board diputar ulang tiap 7 detik supaya terlihat. Di aplikasi, animasi masuk cukup sekali saat layar berganti.
- Teks dan angka adalah contoh (kuis "Geografi Sumatra", 27 pemain, PIN 408 213).
- `sorak.my.id` di Proyektor-1 hanya contoh alamat.

| File | Layar di aplikasi |
|---|---|
| Logo.html | Logo, lockup, dan ikon aplikasi |
| Gerak.html | Enam gerakan dan durasinya |
| HP-1-Masuk.html | `/` (masukkan PIN) |
| HP-2-Nama.html | `/play/:pin`, form nama |
| HP-3-Lobby.html | `/play/:pin`, lobby, termasuk tombol Sorak |
| HP-4-Soal.html | `/play/:pin`, tahap question |
| HP-5-Terkirim.html | `/play/:pin`, setelah answer_received |
| HP-6-Benar.html | `/play/:pin`, result benar |
| HP-7-Salah.html | `/play/:pin`, result salah / tidak menjawab |
| HP-8-Akhir.html | `/play/:pin`, final |
| HP-9-Terputus.html | `/play/:pin`, terputus dan menyambung ulang |
| Proyektor-1-Lobby.html | `/host/:pin`, lobby (dengan aliran sorak dan saklarnya) |
| Proyektor-2-Soal.html | `/host/:pin`, question |
| Proyektor-3-Kunci.html | `/host/:pin`, reveal bagian sebaran jawaban |
| Proyektor-4-Skor.html | `/host/:pin`, reveal bagian papan skor |
| Proyektor-5-Podium.html | `/host/:pin`, ended |
| Guru-1-Masuk.html | `/login` |
| Guru-2-Kuis.html | `/quizzes` |
| Guru-3-Editor.html | editor kuis |
| Guru-4-Mainkan.html | dialog pilih mode sebelum membuat room |
