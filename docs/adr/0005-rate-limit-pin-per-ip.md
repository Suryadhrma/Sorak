# ADR 0005: Rate limit tebakan PIN 120 per menit per IP

- Status: diterima
- Tanggal: 2026-10-08

## Konteks

PIN room hanya 6 digit (1.000.000 kemungkinan) dan siswa masuk tanpa akun. Tanpa batas, seseorang bisa menebak PIN berulang-ulang untuk masuk ke kelas orang lain. Rencana awal: 10 tebakan per menit per IP.

Fakta yang mengubah rencana itu:

- Satu kelas biasanya memakai WiFi sekolah yang sama. Router sekolah menerjemahkan alamat lokal semua HP ke satu alamat publik (NAT), jadi dari sisi server satu kelas terlihat sebagai **satu IP**.
- Setiap siswa melakukan 2 request: cek PIN (`GET /api/rooms/:pin`), lalu membuka WebSocket (`/ws/play/:pin`). Kelas 40 siswa = 80 request dari satu IP dalam satu menit. Dengan batas 10, siswa ke-6 dan seterusnya ditolak.
- Dokumentasi Cloudflare sendiri tidak menyarankan IP sebagai kunci rate limit karena alasan ini.
- Binding Workers Rate Limiting hanya mendukung periode 10 atau 60 detik. Hitungannya per lokasi Cloudflare, longgar, dan diperbarui di latar belakang; sengaja tidak dirancang sebagai penghitung presisi. Di `wrangler dev` dan vitest-pool-workers hitungannya persis (dicek 2026-10-08).
- Tidak ada kunci lain yang tersedia sebelum siswa masuk: siswa belum punya akun maupun token.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. 10 per menit per IP (rencana awal) | Tebakan sangat lambat. | Memblokir kelas sungguhan: siswa ke-6 di WiFi sekolah ditolak. |
| B. Tanpa rate limit | Tidak ada siswa yang tertolak. | Penebak bebas mencoba 1.000.000 PIN; setiap tebakan juga memakan kuota Worker dan Durable Object. |
| C. 120 per 60 detik per IP, untuk cek PIN dan WebSocket pemain | Satu IP cukup untuk 60 siswa yang masuk dalam semenit. Penebak dari satu IP maksimal 172.800 tebakan per hari: dengan satu room aktif di antara 1.000.000 PIN, peluangnya menemukan room sekitar 0,17 kali per hari. | Acara aula 200 orang di satu WiFi yang masuk dalam menit yang sama bisa sebagian kena 429. Penebak yang memakai banyak IP tidak terbendung. |

## Keputusan

> Draf dari Claude Code. Surya menulis ulang bagian ini dengan kata-katanya sendiri.

Pilihan C. Batasnya dipilih dari kebutuhan kelas sungguhan, bukan dari angka yang terdengar aman: satu WiFi sekolah harus bisa memasukkan satu kelas penuh dalam semenit. Pada batas itu, menebak PIN tetap tidak menguntungkan. Kalaupun berhasil, penebak hanya bisa ikut kuis kelas dan namanya terlihat guru di lobby, karena siswa tidak punya data pribadi yang bisa diambil.

## Konsekuensi

- Binding `PIN_LOOKUP` (`ratelimits`, `namespace_id` "2604", `simple: { limit: 120, period: 60 }`) di `apps/api/wrangler.jsonc`. Angkanya juga ada di `PIN_LOOKUP_LIMIT` (`@sorak/shared`) sebagai dokumentasi, dan test api memastikan keduanya sama.
- Kunci = header `CF-Connecting-IP`. Di luar jaringan Cloudflare (tanpa header itu) semua request berbagi kunci `"unknown"`.
- Melewati batas: `429 RATE_LIMITED`. Layar siswa menampilkan "Terlalu banyak yang mencoba masuk dari jaringan ini. Tunggu sebentar, lalu coba lagi.", dan percobaan berikutnya berhasil setelah jendela 60 detik bergeser.
- Jalur WebSocket host tidak dibatasi di sini: sudah wajib login dan cek Origin.
- **WebSocket pemain ikut dihitung, jadi reconnect massal bisa kena 429.** Kalau WiFi aula putus sebentar, 200 HP akan reconnect dari satu IP hampir bersamaan dan sebagian akan tertolak dulu. Backoff + jitter di Hari 4 meredamnya; solusi lengkapnya dibahas di spec Hari 4.
- Hitungan produksi per lokasi Cloudflare dan longgar, jadi angka 120 adalah perkiraan, bukan jaminan tepat.

## Lanjutan (2026-10-09): reconnect massal dan batas terpisah untuk WebSocket

### Konteks

Mulai Hari 4, HP tersambung ulang sendiri (backoff + jitter) setiap kali socket putus. Kalau WiFi aula yang dipakai 200 siswa putus sebentar lalu pulih, ratusan HP dari satu IP membuka WebSocket hampir bersamaan. Dengan satu batas 120 per menit untuk cek PIN dan WebSocket, sebagian besar reconnect itu kena 429 dan siswa tertinggal soal, justru di saat sinyal sedang buruk. Test api membuktikannya: 200 upgrade dari satu IP dengan batas 120 menghasilkan 80 penolakan.

### Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. Satu batas 120 untuk keduanya (keadaan sebelumnya) | Sederhana. | Reconnect massal tertolak sebagian; siswa kehilangan soal. |
| B. Penanda reconnect di URL (misalnya `?resume=1`) yang dikecualikan dari batas | Reconnect tidak pernah dibatasi. | Penanda di URL bisa dipasang siapa saja, jadi penebak PIN tinggal menambahkannya untuk lolos dari batas. Token tidak boleh di URL (tercatat di log), jadi server tidak bisa membuktikan penanda itu sah sebelum upgrade. |
| C. Kunci IP + PIN untuk WebSocket | Kelas yang reconnect hanya memakai kuota PIN-nya sendiri. | Setiap PIN mendapat kuota baru, sehingga tebakan antar-PIN dari satu IP tidak terbatas: batas per IP kehilangan fungsinya. |
| D. Binding terpisah `WS_CONNECT` 600 per 60 detik per IP, khusus `GET /ws/play/:pin`; `PIN_LOOKUP` 120 tetap untuk `GET /api/rooms/:pin` | Reconnect satu aula (200 HP, bahkan 2–3 kali dalam semenit) muat. Tebakan PIN lewat cek PIN tetap dibatasi 120. | Penebak bisa beralih ke jalur WebSocket dengan batas 600. |

### Keputusan

> Ditulis Surya.

### Konsekuensi

- `apps/api/wrangler.jsonc`: binding `WS_CONNECT` (`namespace_id` "2605", `simple: { limit: 600, period: 60 }`). `WS_CONNECT_LIMIT` di `@sorak/shared` dicek sama dengan binding itu oleh test api, seperti `PIN_LOOKUP_LIMIT`.
- Jalur WebSocket pemain tidak lagi memakai `PIN_LOOKUP`, jadi reconnect tidak menghabiskan kuota cek PIN siswa yang baru mau masuk.
- **Risiko yang diterima:** penebak dari satu IP bisa mencoba sampai 600 PIN per menit lewat WebSocket (864.000 per hari; dengan satu room aktif di antara 1.000.000 PIN, peluang menemukannya sekitar 0,86 kali per hari). Setiap percobaan ke PIN yang tidak ada hanya dijawab close 4004 tanpa data apa pun, dan penebak yang berhasil masuk tetap terlihat guru di lobby.
- Hitungan binding tetap per lokasi Cloudflare dan longgar; angka 600 adalah perkiraan.
