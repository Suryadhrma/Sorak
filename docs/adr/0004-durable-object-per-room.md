# ADR 0004: Satu Durable Object per room

- Status: diterima
- Tanggal: 2026-10-08

## Konteks

Satu room adalah satu kelas yang bermain bersama: sampai 200 HP siswa dan satu atau lebih layar guru tersambung lewat WebSocket. Semua jawaban harus dinilai di satu tempat dengan jam yang sama, supaya urutan dan skor adil (aturan domain 2: server tidak percaya klien).

Batasan:

- Biaya Rp0 (ADR 0001, ADR 0002). Tidak ada server yang menyala terus.
- Worker biasa tidak punya memori bersama antar-request. Dua request dari room yang sama bisa jalan di mesin berbeda, sehingga Worker saja tidak bisa memegang state game.
- Kuota Durable Object di Workers Free (dokumentasi Cloudflare, dicek 2026-10-08):
  - 100.000 request per hari. Membuka WebSocket dihitung 1 request; pesan masuk dihitung 1 request per 20 pesan; pesan keluar gratis.
  - Durasi 13.000 GB-s per hari. Dengan memori 128 MB, sekitar 28 jam objek aktif per hari. Objek yang boleh hibernasi tidak dihitung, dan heartbeat yang dijawab auto-response tidak menambah durasi.
  - Kuota habis: operasi berikutnya gagal sampai 00:00 UTC.
- Hitungan kasar satu game penuh (200 pemain, 20 soal): 200 koneksi + (200 × 2 pesan × 20 soal) / 20 = sekitar 600 request. Kalau ping aplikasi juga dihitung (dokumentasi tidak tegas), tambah sekitar 1.200 untuk game 30 menit. Puluhan game per hari masih jauh di bawah 100.000.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. Server WebSocket biasa (Node) + Redis pub/sub antar-instance | Pola yang paling banyak tutorialnya; bisa dipindah ke penyedia mana pun. | Server dan Redis harus menyala terus; layanan gratisan umumnya tidur saat sepi atau dibatasi koneksinya. Dua sistem untuk dioperasikan. State game tersebar: instance memegang socket, Redis meneruskan pesan, sehingga dua jawaban di instance berbeda bisa diproses bersamaan (race condition) kecuali ada kunci tambahan. |
| B. Satu Durable Object global untuk semua room | Satu objek, sederhana. | Satu objek memproses satu event pada satu waktu: semua kelas di seluruh Indonesia antre di satu tempat. Bottleneck, dan satu bug menjatuhkan semua room. |
| C. Satu Durable Object per room, dialamatkan dengan `getByName("room:" + pin)` | Semua pemain dengan PIN sama otomatis bertemu di objek yang sama, tanpa server pusat. Satu objek memproses event satu per satu (actor model), jadi jawaban di satu room tidak pernah balapan. Hibernasi membuat room yang menunggu tidak memakan durasi. Gratis di Workers Free (backend SQLite). | Satu room = satu objek = satu thread di satu lokasi: batas 200 pemain per room berasal dari sini. Terikat ke Cloudflare. Kode harus siap objek dikeluarkan dari memori kapan saja (state dibangun ulang dari storage dan attachment). |

## Keputusan

> Draf dari Claude Code. Surya menulis ulang bagian ini dengan kata-katanya sendiri.

Pilihan C. Room adalah "atom" koordinasi Sorak: semua yang perlu urutan pasti (siapa masuk duluan, jawaban mana yang tiba sebelum batas waktu, skor) terjadi di dalam satu room, dan tidak ada yang perlu dikoordinasikan antar-room. Durable Object memberi tepat itu: satu objek per PIN, memproses event satu per satu, dengan storage sendiri. Pilihan A butuh dua layanan yang menyala terus dan kunci tambahan untuk mendapatkan jaminan urutan yang sama, sedangkan pilihan B menjadikan semua kelas saling menunggu.

## Konsekuensi

- Batas `MAX_PLAYERS_PER_ROOM` = 200 adalah batas desain, bukan angka acak: semua pesan satu room melewati satu thread. Load test (Hari 6) membuktikan berapa yang benar-benar muat dalam batas CPU.
- GameRoom wajib tahan hibernasi: roster hidup di attachment socket dan dibangun ulang di constructor; tidak ada `setInterval`/`setTimeout` berulang, timer memakai alarm (aturan domain 3). Test hibernasi memakai `evictDurableObject`.
- PIN adalah nama objek. PIN yang sudah selesai (`deleteAll`) bebas dipakai room baru, karena objek tanpa storage sama dengan objek baru.
- **Worker memanggil GameRoom lewat fetch internal, bukan RPC.** Tipe Durable Object lintas Worker (`wrangler types` dengan dua config) membuat TypeScript api membaca source realtime memakai `Env` milik api, sehingga typecheck gagal begitu GameRoom memakai binding-nya sendiri (`GAME_EVENTS`); dibuktikan 2026-10-08. Tanpa tipe itu, method RPC tidak bisa dipanggil tanpa `as`. Kontraknya tetap skema Zod di `room-control.ts`, divalidasi di kedua sisi; endpoint internal dibatasi allowlist (`POST /init`, `GET /join-info`, `GET /connect`) dan Worker selalu memakai URL internal tetap. Keputusan ini ditinjau ulang kalau `wrangler types` mendukung tipe Durable Object lintas Worker dengan bersih.
- Socket yang ditolak sebelum dipakai (room tidak ada, host bukan pemilik) diterima dengan `accept()` biasa lalu langsung ditutup, bukan `acceptWebSocket`: dengan hibernasi, close code baru sampai ke klien sekitar 11 detik kemudian (diukur di `wrangler dev`).
- Server tidak bisa langsung tahu HP yang hilang sinyal, karena heartbeat dijawab auto-response tanpa membangunkan objek. Socket basi diperiksa hanya saat dibutuhkan (nickname bentrok, room penuh) dengan `STALE_SOCKET_MS`; nama yang putus bisa tetap tampil di layar guru sampai saat itu. Diterima untuk Hari 2, dibahas lagi di Hari 4.
