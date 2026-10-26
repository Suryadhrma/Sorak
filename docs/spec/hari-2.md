# Spec Hari 2: room, PIN, dan lobby live

- Tanggal: 2026-10-09
- Hasil akhir hari ini:
  - guru menekan "Mainkan" pada kuisnya, lalu mendapat PIN 6 digit dan layar lobby;
  - siswa membuka situs di HP, memasukkan PIN dan nickname, lalu masuk lobby;
  - nama siswa muncul di layar guru dalam kurang dari 1 detik.

  Belum ada soal yang dimainkan; tombol Mulai dikerjakan di Hari 3.
- Dokumen acuan:
  - CLAUDE.md;
  - `.claude/rules/realtime.md`, `.claude/rules/api.md`, `.claude/rules/web.md`;
  - `packages/shared/src/` (protokol);
  - dokumen Drive "System Design" bagian 4–6 dan "Protokol Pesan WebSocket".

## 1. Keputusan yang berubah dari rencana awal

### Rate limit tebakan PIN: 120 per menit per IP, bukan 10

Rencana awal membatasi tebakan PIN 10 kali per menit per IP. Batas ini akan memblokir kelas sungguhan:

- Satu kelas biasanya memakai WiFi sekolah yang sama. Dari luar, semua HP di jaringan itu terlihat sebagai **satu alamat IP**. Router sekolah menerjemahkan alamat lokal tiap HP ke satu alamat publik; teknik ini disebut **NAT**.
- Setiap siswa melakukan 2 request: cek PIN, lalu membuka WebSocket. Kelas 40 siswa = 80 request dari satu IP dalam satu menit. Dengan batas 10, siswa ke-6 dan seterusnya ditolak.
- Dokumentasi Cloudflare sendiri menyarankan tidak memakai IP sebagai kunci rate limit karena alasan ini.

Keputusan: **batas 120 request per 60 detik per IP**, berlaku untuk cek PIN dan WebSocket pemain, lewat binding Workers Rate Limiting. Hitungannya:

- Satu IP cukup untuk 60 siswa yang masuk dalam satu menit.
- Penebak dari satu IP mendapat maksimal 172.800 tebakan per hari. Dengan satu room aktif di antara 1.000.000 kemungkinan PIN, peluangnya menemukan room sekitar 0,17 kali per hari.
- Kalaupun berhasil, ia hanya bisa ikut kuis kelas, dan guru melihat namanya di lobby.

Risiko yang diterima: acara aula 200 orang di satu WiFi yang semuanya masuk dalam menit yang sama bisa sebagian kena 429. Layar menampilkan "coba lagi sebentar", dan siswa yang mencoba lagi sesudahnya akan berhasil.

Catat sebagai ADR 0005.

### Endpoint dan pesan mengikuti dokumen Protokol, bukan System Design

- WebSocket pemain: `GET /ws/play/:pin` tanpa `?session=`. Token dikirim di pesan `resume`.
- Kode error REST bertambah: `RATE_LIMITED`, `ROOM_FULL`, `GAME_ALREADY_STARTED`.

## 2. Perubahan di `packages/shared`

### Konstanta baru

| Nama | Nilai | Arti |
|---|---|---|
| `PIN_CREATE_ATTEMPTS` | 5 | Percobaan membuat PIN unik sebelum menyerah |
| `LOBBY_IDLE_TIMEOUT_MS` | 1.800.000 (30 menit) | Lobby tanpa host tersambung selama ini ditutup |
| `PIN_LOOKUP_LIMIT` | `{ limit: 120, periodSec: 60 }` | Dokumentasi angka binding rate limit. Nilai sebenarnya ditulis di wrangler.jsonc, dan test api memastikan keduanya sama |
| `STALE_SOCKET_MS` | `HEARTBEAT.intervalMs * 2 + HEARTBEAT.timeoutMs` (35 detik) | Socket pemain tanpa pong selama ini dianggap mati. Toleransi satu ping hilang karena sinyal jelek |

### Kontrak kontrol Worker ke GameRoom (`room-control.ts`)

Worker memanggil GameRoom lewat **fetch internal, bukan RPC**. Tipe Durable Object lintas Worker membuat TypeScript api membaca source realtime dengan `Env` milik api, sehingga typecheck gagal begitu GameRoom memakai binding-nya sendiri (dibuktikan di Fase 0; dicatat di ADR 0004).

`sorak` dan `sorak-realtime` di-deploy terpisah. Artinya, untuk sementara bisa saja versi keduanya berbeda; ini disebut **version skew**. Jadi data kontrol divalidasi Zod **di kedua sisi**, sama seperti pesan WebSocket. Skemanya `z.object` biasa, supaya field baru dari versi yang lebih baru diabaikan versi lama.

- URL internal tetap `ROOM_CONTROL_ORIGIN` (`https://room`) dengan path di `RoomControlPath`:
  - `POST /init`: body `InitRoomInput`, jawaban `InitRoomResult`;
  - `GET /join-info`: jawaban `JoinInfo`;
  - `GET /connect`: wajib header `Upgrade: websocket`.

  Path lain → 404.
- Header `RoomHeader.route` (`X-Sorak-Route`, nilai `RoomRoute`: `play` atau `host`) dan `RoomHeader.hostId` (`X-Sorak-Host-Id`).
- `InitRoomInput`: `{ gameId: GameId, hostId, pin: Pin, scoringMode: ScoringMode, teamMode: boolean, quiz: QuizSnapshot }`.
- `InitRoomResult`: `{ ok: true } | { ok: false, reason: "pin_in_use" }`.
- `JoinInfo`: `{ status: "open" | "not_found" | "started" | "full", playerCount }`.

### Attachment socket yang menunggu pesan pertama

Ganti `PendingAttachment` menjadi dua bentuk, supaya GameRoom tahu socket itu datang dari jalur mana:

- `{ role: "pending_player", connectedAt }`;
- `{ role: "pending_host", hostId, connectedAt }`. `hostId` sudah diverifikasi Worker dari cookie.

### Codec

`decodeWith` membedakan dua kegagalan baru supaya GameRoom bisa membalas kode yang tepat:

- **`unsupported_version`**: JSON valid, berisi `t` dan `v`, tapi `v !== PROTOCOL_VERSION`. Dicek setelah `JSON.parse`, sebelum skema.
- **`invalid_schema`**: sekarang juga membawa `issuePaths: string[]`, misalnya `["nickname"]`, di samping `detail`.

Test baru wajib ada untuk keduanya.

### REST room (`api/room.ts`)

- `CreateRoomInput`: `{ quizId: QuizId }`.
  - Mode skor dan mode tim belum bisa dipilih; Worker memakai `classic` dan `false`. Pilihan mode ditambahkan di hari fitur itu dibuat, supaya tidak ada opsi yang belum berfungsi.
- `CreateRoomResult`: `{ pin }`.
- `RoomLookup`: `{ pin, playerCount }`.

## 3. GameRoom (`apps/realtime`)

### Constructor

Di dalam `blockConcurrencyWhile`, constructor melakukan tiga hal:

1. Membaca `state` dan `quiz` dari storage, lalu memvalidasinya dengan skema.
2. Membangun peta socket dari `getWebSockets()` dan `deserializeAttachment()`, juga divalidasi.
3. Mendaftarkan auto-response `ping` → `pong`.

Tidak ada `setInterval` atau `setTimeout` berulang.

### Routing `fetch`

Allowlist ketat: `POST /init`, `GET /join-info`, `GET /connect` (wajib `Upgrade: websocket`, kalau tidak 426). Method atau path lain → 404. Endpoint ini hanya bisa dicapai lewat binding, karena `sorak-realtime` tidak punya `workers_dev` maupun route publik.

### `POST /init`

- Validasi `InitRoomInput`. Input tidak valid dijawab 400 dan dicatat sebagai error; ini bug di Worker, bukan input pengguna.
- Kalau key `state` sudah ada, kembalikan `{ ok: false, reason: "pin_in_use" }`. Pengecekan dan penulisan tidak boleh dipisah oleh `await` lain, supaya dua `init` bersamaan untuk PIN yang sama tidak sama-sama lolos. Ini disebut **check-then-act yang atomik**.
- Tulis `quiz` dan `state` (phase `lobby`, `createdAt`) dalam satu `put`.
- Pasang alarm `createdAt + LOBBY_IDLE_TIMEOUT_MS`.
- Total biaya: 3 baris tulis storage.

### `GET /join-info`

Tidak menulis apa pun:

- tidak ada `state` → `not_found`;
- phase bukan `lobby` → `started`;
- jumlah pemain ≥ `MAX_PLAYERS_PER_ROOM` → `full`. Yang dihitung hanya socket dengan attachment `player`, bukan socket pending;
- selain itu → `open`.

### `GET /connect` (upgrade WebSocket dari Worker)

- Jalur dibaca dari header `X-Sorak-Route` (`play` atau `host`) yang diisi Worker. Untuk `host`, header `X-Sorak-Host-Id` juga diisi Worker.
- Socket diterima dengan `ctx.acceptWebSocket(ws, [tag])`, dengan tag `player` atau `host`. Tag membuat broadcast cukup memakai `getWebSockets("host")` tanpa memeriksa semua socket.
- Kalau room tidak ada, socket tetap diterima, lalu langsung ditutup dengan `ROOM_NOT_FOUND` (4004). Browser tidak bisa membaca alasan penolakan HTTP saat upgrade, tapi bisa membaca close code.
- Kalau `X-Sorak-Host-Id` tidak sama dengan `state.hostId`, tutup juga dengan 4004. Jangan beri tahu bahwa room-nya ada.

### Alur setiap pesan masuk

Urutannya dari yang paling murah ke paling mahal:

1. **Token bucket per socket** (`RATE_LIMIT`), disimpan di memori. Kalau habis, tutup dengan 4008.
2. **Decode** dengan decoder yang sesuai tag socket.
   - `unsupported_version`: kirim `error UNSUPPORTED_VERSION`, lalu tutup 4005.
   - `invalid_schema` pada pesan `join` dengan path `nickname`: kirim `error NICKNAME_INVALID`. Ini tidak dihitung sebagai pesan rusak, karena hanya salah ketik.
   - Kegagalan lain: kirim `error BAD_MESSAGE`. Setelah `MAX_CONSECUTIVE_INVALID_MESSAGES` kali beruntun, tutup 4009. Penghitungnya disimpan di memori dan di-reset oleh pesan yang valid.
3. **Socket pending yang belum mengirim pesan pembuka** hanya boleh mengirim `join`/`resume` (pemain) atau `host_hello` (host). Pesan lain dibalas `error NOT_JOINED`.
4. **Cek tahap** dengan `isAllowedInPhase`.
   - Pesan pemain di luar tahap diabaikan, cukup dicatat di log.
   - Pesan host di luar tahap dibalas `error NOT_ALLOWED_NOW`.

### Pesan yang ditangani hari ini

**Socket basi.** HP yang kehilangan sinyal tidak sempat menutup socket, dan `ping` dijawab auto-response tanpa membangunkan GameRoom. Jadi GameRoom memeriksa kesegaran socket hanya saat dibutuhkan:
- Fungsi murni `isStale(now, lastPongAt, joinedAt)`: basi kalau `now - max(lastPongAt ?? 0, joinedAt) > STALE_SOCKET_MS`. `lastPongAt` dari `getWebSocketAutoResponseTimestamp(ws)`. Socket yang baru join dan belum sempat ping (`null`) diukur dari `joinedAt`, sehingga tidak langsung dianggap basi.
- Socket basi ditutup dengan `GOING_AWAY` (1001). Host dikirimi `player_left` (`kicked: false`), dan pemain lain dikirimi `lobby`.

**`join`** (phase `lobby`):
- Room terlihat penuh: tutup dulu semua socket pemain yang basi. Kalau tetap penuh, kirim `error ROOM_FULL`, lalu tutup 4010.
- Nickname kembar (bandingkan dengan `nicknameKey()` terhadap semua attachment pemain):
  - pemegang nama basi: tutup socket itu seperti di atas, lalu join dilanjutkan;
  - pemegang nama segar: kirim `error NICKNAME_TAKEN`, socket tetap terbuka.
- Kalau lolos:
  - `playerId = crypto.randomUUID()`;
  - `sessionToken` = 16 byte acak dalam base64url;
  - simpan SHA-256 hex dari token di attachment (`PlayerAttachment`; skor 0, latency null);
  - kirim `welcome` (dengan token dan snapshot lobby) ke pemain itu;
  - kirim `player_joined` ke semua socket host;
  - kirim `lobby` (jumlah pemain) ke semua socket pemain.
- Tidak ada tulis storage.

**`resume`**:
- Di lobby, roster hanya ada di attachment socket yang masih terbuka. Cari socket pemain lain yang tokenHash-nya sama:
  - **ketemu**: tutup socket lama dengan `REPLACED` (4002), pindahkan attachment ke socket baru, lalu kirim `welcome` tanpa token;
  - **tidak ketemu**: kirim `error SESSION_INVALID`, lalu tutup 4003.
- Resume di tahap lain dikerjakan di Hari 4, bersama snapshot roster di storage.

**`host_hello`**:
- Ubah attachment menjadi `HostAttachment`.
- Kirim `host_welcome` berisi daftar pemain dari attachment, `question: null`, dan `answered: 0`.
- Boleh ada lebih dari satu socket host, misalnya laptop proyektor dan HP guru.

**`end`** (di lobby, artinya membatalkan room):
- Tutup semua socket dengan `ROOM_CLOSED` (4000);
- `deleteAll()`;
- `deleteAlarm()`.

**`react`**, **`kick`**, **`start`**: belum ditangani hari ini.
- `react` dan `kick` diabaikan dengan log. `kick` dikerjakan bersama moderasi di Hari 4.
- `start` dibalas `error NOT_ALLOWED_NOW` dengan pesan "belum tersedia". Hari 3 menggantinya.

### `webSocketClose`

Pemain yang putus di lobby:
- kirim `player_left` (`kicked: false`) ke host;
- kirim `lobby` ke pemain lain.

Host yang putus tidak memicu pesan apa pun.

Socket tidak perlu ditutup manual di handler ini: dengan compatibility date ≥ 2026-04-07 (flag `web_socket_auto_reply_to_close`), runtime membalas close secara otomatis (dicek di Fase 0).

### `alarm()` di tahap lobby

- Kalau masih ada socket host yang tersambung, pasang ulang alarm `+LOBBY_IDLE_TIMEOUT_MS`.
- Kalau tidak ada, tutup semua socket dengan 4000 dan `deleteAll()`. PIN bebas dipakai lagi.

### Broadcast

Mengikuti `.claude/rules/realtime.md`:
- encode pesan sekali saja;
- satu socket yang gagal dikirimi tidak boleh menghentikan pengiriman ke socket lain.

## 4. API Worker (`apps/api`)

### `POST /api/rooms` (`requireHost`)

1. Validasi `CreateRoomInput`. Ambil kuis dan soalnya dengan filter `host_id`; kuis milik host lain → 404.
2. Kuis tanpa soal → 409 `CONFLICT`, dengan pesan "Tambahkan minimal satu soal".
3. Ubah baris D1 menjadi `QuizSnapshot` lewat satu fungsi pemetaan. `imageUrl: null`.
4. Ulangi maksimal `PIN_CREATE_ATTEMPTS` kali:
   - buat PIN;
   - ambil stub lewat satu fungsi `roomStub(env, pin)` = `GAME_ROOM.getByName("room:" + pin)`. Semua rute (rooms dan ws) memakai fungsi ini, supaya nama objek tidak pernah berbeda;
   - panggil `initRoom(stub, input)`, fungsi kecil yang membungkus `fetch` ke `POST /init` dan memvalidasi jawaban dengan `InitRoomResult`. Route tidak berisi kode fetch mentah;
   - kalau `pin_in_use`, coba PIN lain.
5. Kalau semua percobaan gagal, kembalikan 500 `INTERNAL` dan catat di log. Peluangnya mendekati nol.
6. Hasil sukses: 201 `{ pin }`.

**Pembuat PIN** ada di modul `pin.ts`:
- Ambil satu angka acak 32-bit dengan `crypto.getRandomValues`.
- Kalau angkanya ≥ 4.294.000.000, ulangi. Ini disebut **rejection sampling**: membuang angka di ujung rentang supaya setiap PIN punya peluang yang sama. Tanpa ini, `% 1.000.000` sedikit lebih sering menghasilkan angka kecil (**modulo bias**).
- `String(n % 1_000_000).padStart(6, "0")`. PIN boleh diawali nol.
- Test: format selalu `Pin`, dan angka di ujung rentang ditolak (sumber acak bisa diganti di test).

### `GET /api/rooms/:pin` (publik)

- Rate limit `PIN_LOOKUP` dengan kunci IP dari header `CF-Connecting-IP`. Kalau tidak ada, pakai `"unknown"`. Melewati batas → 429 `RATE_LIMITED`.
- PIN tidak valid → 404.
- Panggil `getJoinInfo(stub)` (membungkus `GET /join-info` dan validasi `JoinInfo`):
  - `open` → 200 `RoomLookup`;
  - `not_found` → 404;
  - `started` → 409 `GAME_ALREADY_STARTED`;
  - `full` → 409 `ROOM_FULL`.

### `GET /ws/play/:pin` (publik)

- Rate limit yang sama dengan cek PIN.
- Validasi `Pin`; PIN tidak valid → 404 `NOT_FOUND` (bentuk `ApiError`, sama dengan cek PIN). Request yang bukan upgrade → 426.
- Buat Request baru untuk GameRoom. **URL dari klien tidak pernah diteruskan**: URL-nya selalu `https://room/connect`, sehingga request dari internet tidak bisa mencapai `/init` apa pun bentuk URL-nya.
  - salin hanya header jabat tangan WebSocket (allowlist: `Upgrade`, `Connection`, `Sec-WebSocket-*`). Header lain dari klien, termasuk `X-Sorak-Host-Id` palsu dan cookie, otomatis tidak ikut;
  - isi `X-Sorak-Route: play`.

  Tanpa langkah hapus, siswa bisa memalsukan header itu dan mengaku sebagai guru.
- Tidak ada cek Origin, karena jalur ini tidak memakai cookie dan load tester Go tidak mengirim Origin.

### `GET /ws/host/:pin` (`requireHost`)

- **Cek header `Origin` sama dengan `APP_ORIGIN`**; kalau tidak sama, 403 `FORBIDDEN` (kode baru di `ApiErrorCode`). Dicek sebelum `requireHost`, karena lebih murah (tanpa D1).
  - Serangan yang dicegah disebut **Cross-Site WebSocket Hijacking**: situs jahat membuka WebSocket ke Sorak memakai cookie guru yang sedang login.
  - Cookie SameSite=Lax sudah menahan sebagian besar kasus ini; cek Origin adalah lapis kedua.
- Request baru ke `https://room/connect` seperti jalur play, dengan `X-Sorak-Route: host` dan `X-Sorak-Host-Id: <id host dari sesi>`.

### Binding baru di `apps/api/wrangler.jsonc`

- `ratelimits`: nama `PIN_LOOKUP`, `namespace_id: "2604"` (Vybe tidak memakai `ratelimits`), `simple: { limit: 120, period: 60 }`.
- Hasil Fase 0:
  - `wrangler dev`: berjalan, dan hitungan lokal persis;
  - vitest-pool-workers: dibuktikan di Fase C;
  - Free plan: dokumentasi tidak menyebut batasan plan. Bukti pasti didapat di deploy pertama; kalau ditolak, deploy gagal tanpa mengubah apa pun.
- Di produksi, hitungannya per lokasi Cloudflare dan sengaja longgar (bukan penghitung presisi).

## 5. Web (`apps/web`)

| Halaman | Isi |
|---|---|
| `/` | Halaman siswa: kotak PIN 6 digit (keyboard angka di HP), tombol Masuk, dan tautan kecil "Masuk sebagai guru" ke `/login`. |
| `/play/:pin` | Cek PIN dulu. Lalu form nickname, kemudian layar lobby: "Kamu sudah masuk. Tunggu guru memulai", nickname, dan jumlah pemain. |
| `/host/:pin` | Layar proyektor (wajib login): PIN sangat besar, alamat situs, jumlah pemain, nama pemain yang muncul langsung, dan tombol Batalkan (kirim `end`, lalu kembali ke `/quizzes`). |
| `/quizzes` | Tambah tombol "Mainkan" per kuis: POST `/api/rooms`, lalu pindah ke `/host/:pin`. Tombol nonaktif untuk kuis tanpa soal. |

### Modul koneksi

Logika koneksi di luar komponen, sesuai `.claude/rules/web.md`: `socket.ts` (transport bersama), `player-session.ts` (alur pemain), `host-session.ts` (alur host). Komponen hanya membaca view dan memanggil aksi. Isi transport hari ini:
- membuka WebSocket ke alamat yang sama dengan halaman (`ws:` atau `wss:` mengikuti `location.protocol`);
- mengirim pesan pembuka;
- decode pesan masuk;
- heartbeat: kirim `ping` setiap `HEARTBEAT.intervalMs`; kalau `pong` tidak datang dalam `HEARTBEAT.timeoutMs`, anggap koneksi mati;
- memberi tahu komponen saat socket tertutup, lengkap dengan close code.

Reconnect otomatis dengan backoff dikerjakan Hari 4. Untuk hari ini, kalau socket tertutup dan `shouldReconnect(code)` bernilai true, tampilkan "Koneksi terputus" dengan tombol "Masuk lagi":
- kirim `resume` dengan token dari localStorage dulu. Di lobby, resume menutup socket lama (4002), jadi tidak ada nama ganda;
- kalau dibalas 4003 atau token tidak ada, kirim `join` dengan nickname yang sama.

### Ketentuan lain

- `sessionToken` disimpan di `localStorage` dengan kunci per PIN, dibungkus try/catch.
- Setiap error dari server punya teks Bahasa Indonesia yang jelas:
  - `NICKNAME_TAKEN` dan `NICKNAME_INVALID` muncul di bawah kotak nickname, tanpa memutus koneksi;
  - `ROOM_FULL`, `GAME_ALREADY_STARTED`, PIN tidak ada, dan 429 masing-masing punya pesan sendiri.
- Setiap state punya tampilan: memuat, error, terputus.
- Halaman siswa tidak memuat kode editor kuis. Pisahkan dengan dynamic import per route (**code splitting**), supaya HP siswa hanya mengunduh yang ia butuhkan. Laporkan ukuran gzip JS halaman siswa setelah build.

## 6. Test minimum

### `apps/realtime` (vitest-pool-workers, siapkan konfigurasinya)

- **init**:
  - sukses;
  - init kedua untuk PIN yang sama → `pin_in_use`;
  - input tidak valid ditolak;
  - `getJoinInfo` mengembalikan keempat status.
- **join**:
  - pemain menerima `welcome` berisi token;
  - host menerima `player_joined`;
  - pemain lain menerima `lobby`;
  - "Dimas" lalu "dimas" → `NICKNAME_TAKEN`, socket tetap terbuka, dan join berikutnya dengan nama lain berhasil di socket yang sama;
  - nickname berisi emoji → `NICKNAME_INVALID`;
  - nickname dipegang socket basi → join berhasil, host menerima `player_left`;
  - nickname dipegang socket segar → tetap `NICKNAME_TAKEN`.
- **`isStale`** (fungsi murni, diuji langsung): pong terbaru, `joinedAt` sebagai batas bawah saat pong `null`, dan tepat di batas `STALE_SOCKET_MS`.
- **routing internal**: path dan method di luar allowlist → 404; `/connect` tanpa upgrade → 426.
- **pesan pertama**:
  - `answer` sebelum `join` → `NOT_JOINED`;
  - `v: 2` → 4005;
  - tiga pesan sampah beruntun → 4009;
  - 11 pesan dalam 1 detik → 4008.
- **resume**:
  - dengan token dari socket yang masih terbuka → socket lama ditutup 4002;
  - token tidak dikenal → 4003.
- **host**:
  - `host_hello` → `host_welcome` berisi pemain yang sudah ada;
  - hostId salah → 4004;
  - room tidak ada → 4004.
- **putus**: pemain menutup socket → host menerima `player_left`.
- **end di lobby**: semua socket menerima 4000, dan storage kosong.
- **alarm lobby**:
  - tanpa host → room ditutup;
  - dengan host → alarm dipasang ulang.

  Gunakan helper alarm dari `cloudflare:test`.
- **ROOM_FULL**: coba dengan 200 socket sungguhan. Kalau test melebihi 10 detik, uji fungsi murni penentu status join, lalu laporkan. Tambah kasus: room penuh dengan satu socket basi → join berhasil.
- **hibernasi**: `evictDurableObject(stub)` dari `cloudflare:test` (pool-workers ≥ 0.16.20; terpasang 0.22). Uji bahwa roster dan state pulih setelah objek dikeluarkan dari memori.

### `apps/api`

GameRoom di test api adalah test double. Kembangkan test double itu jadi **fake** kecil: `POST /init` menolak PIN yang ada di daftar "sudah dipakai", dan `GET /join-info` mengembalikan status yang diatur test. Alasannya, logika yang diuji di sini adalah logika Worker (percobaan ulang, pemetaan status, header). GameRoom asli diuji di paketnya sendiri, dan sambungan keduanya diuji manual lewat `pnpm dev`.

- **`POST /api/rooms`**:
  - sukses;
  - kuis host lain → 404;
  - kuis tanpa soal → 409;
  - PIN pertama bentrok → percobaan kedua berhasil;
  - semua percobaan bentrok → 500.
- **`GET /api/rooms/:pin`**:
  - keempat status;
  - PIN `abc` → 404;
  - request ke-121 dari IP yang sama → 429. Kalau hitungan binding tidak stabil di test, test-nya tidak dihapus: binding `PIN_LOOKUP` diganti fake yang selalu `success: false`. Yang diuji adalah pemetaan "limit habis" ke 429 `RATE_LIMITED`, bukan ketepatan hitungan Cloudflare.
- **`PIN_LOOKUP_LIMIT` sama dengan `ratelimits` di wrangler.jsonc**: `vitest.config.ts` membaca config lewat `unstable_readConfig` dari wrangler, lalu meneruskannya sebagai binding test.
- **WebSocket**:
  - header `X-Sorak-Host-Id` palsu di jalur play tidak sampai ke GameRoom;
  - jalur host tanpa cookie → 401;
  - Origin asing → 403.
- **Pembuat PIN**.

### `packages/shared`

- codec `unsupported_version` dan `issuePaths`;
- skema kontrol room dan attachment baru;
- `STALE_SOCKET_MS` = 35 detik.

## 7. Uji manual dengan dua HP (setelah Fase web)

1. `pnpm dev` dan `pnpm --filter web dev --host` (tanpa `--` di tengah; dengan `--`, Vite mengabaikan `--host`). Laptop dan HP harus di WiFi yang sama.
2. Laptop: login, buka `/quizzes`, tekan "Mainkan" pada Kuis Demo.
3. HP 1 dan HP 2 membuka `http://<IP-laptop>:5173`, mengisi PIN, lalu nickname "Dimas" dan "dimas". HP 2 harus ditolak; ganti nama, lalu masuk.
4. Ukur:
   - dari tombol Masuk ditekan sampai layar lobby muncul (target < 5 detik);
   - dari HP masuk sampai nama muncul di layar guru (target < 1 detik).
5. Matikan WiFi HP 1. HP 1 menampilkan "Koneksi terputus". Nyalakan lagi WiFi, lalu tekan "Masuk lagi": berhasil dengan nama yang sama, dan **tidak ada nama ganda** di layar guru.
   - Keterbatasan yang diketahui (untuk Hari 4): selama HP 1 putus, namanya boleh tetap tampil di layar guru, karena server baru tahu socket mati setelah TCP timeout atau saat socket itu diperiksa basi.
6. Tekan Batalkan di laptop. HP 2 menampilkan "Room ditutup".

## 8. ADR yang ditulis hari ini

- `0004-durable-object-per-room.md`: satu Durable Object per room, dialamatkan dengan `idFromName("room:" + pin)` (actor model), dibandingkan server WebSocket biasa + Redis pub/sub. Bahan:
  - Redis butuh server yang selalu menyala dan tidak gratis;
  - actor model membuat satu room diproses satu antrean, jadi tidak ada race condition antar jawaban;
  - risikonya: satu objek adalah satu titik, sehingga batas 200 pemain per room berasal dari sini.
  - Konsekuensi: Worker memanggil GameRoom lewat fetch internal, bukan RPC, karena tipe DO lintas Worker bentrok dengan `Env` masing-masing Worker. Keputusan ini ditinjau ulang kalau `wrangler types` mendukung tipe DO lintas Worker dengan bersih.
- `0005-rate-limit-pin-per-ip.md`: isi bagian 1 spec ini. Konsekuensi: WebSocket ikut dihitung, jadi reconnect massal (WiFi aula putus sebentar) bisa sebagian kena 429; solusinya dibahas di spec Hari 4.

Seperti biasa, Claude Code menulis draf, lalu Surya menulis ulang bagian Keputusan dengan kata-katanya sendiri.

## 9. Di luar cakupan Hari 2

- Tombol Mulai, soal, timer, dan skor (Hari 3).
- Reconnect otomatis dan resume di tengah game (Hari 4).
- Kick dan moderasi nickname (Hari 4).
- Mode tim dan pilihan mode skor.
- QR code PIN.
- Halaman `/privacy` dan publish OAuth consent screen. Saat ini status Google OAuth Testing; guru pilot ditambahkan sebagai test user. Halaman privasi dibuat di Hari 10 bersama landing page.
