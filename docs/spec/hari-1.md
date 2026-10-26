# Spec Hari 1: login host dan editor kuis

- Tanggal: 2026-10-03
- Hasil akhir hari ini: guru bisa masuk dengan akun Google, membuat kuis, mengisi soal pilihan ganda, menyimpan, mengubah, dan menghapusnya. Belum ada game live.
- Dokumen acuan: CLAUDE.md, `.claude/rules/api.md`, `.claude/rules/web.md`, `apps/api/migrations/0001_init.sql`.

## 1. Keputusan yang berubah dari rencana awal

Rencana awal: login email + password yang di-hash PBKDF2. Faktanya:

- Workers menolak PBKDF2 di atas 100.000 iterasi (`NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`).
- Pada 100.000 iterasi, satu hash memakan sekitar 23 ms CPU. Batas Workers Free 10 ms per request.
- OWASP menyarankan 600.000 iterasi untuk PBKDF2-SHA256. Menurunkan iterasi supaya muat 10 ms berarti hash jauh lebih mudah dibobol kalau database bocor.

Keputusan: **host login hanya lewat Google (OAuth 2.0 / OpenID Connect)**. Tidak ada password yang disimpan. Alasannya:

- Worker tidak menghitung hash apa pun. Waktu menunggu Google adalah I/O, jadi tidak dihitung sebagai CPU.
- Hampir semua guru di Indonesia punya akun Google (Gmail atau belajar.id, yang memakai Google Workspace).
- Skema D1 sudah mendukung: `auth_provider = 'google'` dan `provider_subject`.

Keputusan ini dicatat di ADR 0003. Kolom `password_hash` tetap ada di skema, tapi tidak dipakai (migrasi yang sudah diterapkan tidak boleh diubah).

## 2. Kontrak bersama di `packages/shared`

File baru `packages/shared/src/api/` lalu di-export dari `index.ts`. Ini skema REST, bukan protokol WebSocket, jadi `PROTOCOL_VERSION` tidak berubah.

### Konstanta baru di `constants.ts`

Nilainya harus sama dengan CHECK di `0001_init.sql`.

| Nama | Nilai | Pasangan di SQL |
|---|---|---|
| `QUIZ_TITLE_MAX_LENGTH` | 120 | `quizzes.title` |
| `QUIZ_DESCRIPTION_MAX_LENGTH` | 500 | `quizzes.description` |
| `EXPLANATION_MAX_LENGTH` | 500 | `questions.explanation` |
| `DISPLAY_NAME_MAX_LENGTH` | 60 | `hosts.display_name` |
| `DEFAULT_TIME_LIMIT_SEC` | 20 | default `time_limit_sec` |
| `QUIZ_LIST_LIMIT` | 100 | batas baris halaman "Kuis saya" |
| `QUIZ_BODY_MAX_BYTES` | 262144 | batas body PUT/POST kuis. 50 soal penuh berhuruf Arab (2 byte per karakter di UTF-8) = 128.033 byte (diukur di test shared), hampir menyentuh 128 KiB; karakter yang di-escape JSON atau huruf 3–4 byte bisa melewatinya. 256 KiB memberi ruang, dan `JSON.parse` sebesar itu masih jauh di bawah batas CPU. |
| `SESSION_TTL_SEC` | 604800 | umur cookie sesi, 7 hari |
| `OAUTH_STATE_TTL_SEC` | 600 | umur cookie state OAuth, 10 menit |

### Skema (`api/quiz.ts`, `api/host.ts`, `api/errors.ts`)

- `QuizId`, `QuestionId`: `z.uuid()`.
- `QuestionInput`: `{ id?: QuestionId, prompt: Prompt, options: Options, correctIndex: ChoiceIndex, timeLimitSec: int TIME_LIMIT_MIN_SEC..TIME_LIMIT_MAX_SEC, explanation: string trim max EXPLANATION_MAX_LENGTH | null }`.
  - Aturan lintas field: `correctIndex < options.length`, error menempel di path `correctIndex`.
- `QuizInput`: `{ title: string trim 1..QUIZ_TITLE_MAX_LENGTH, description: string trim max QUIZ_DESCRIPTION_MAX_LENGTH | null, questions: QuestionInput[] max MAX_QUESTIONS_PER_QUIZ }`. Boleh 0 soal (kuis draf).
- `QuestionDetail`: `QuestionInput` dengan `id` wajib.
- `QuizDetail`: `{ id, title, description, questions: QuestionDetail[], updatedAt }`, soal diurutkan menurut `position`.
- `QuizSummary`: `{ id, title, description, questionCount, updatedAt }`.
- `Host`: `{ id, email, displayName }`.
- `ApiErrorCode`: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `INTERNAL`. Ini terpisah dari `ErrorCode` WebSocket.
- `ApiError`: `{ error: { code: ApiErrorCode, message: string, fields?: Record<string, string> } }`. `fields` hanya untuk `VALIDATION_FAILED`, berisi path Zod (`questions.3.correctIndex`) ke pesan, supaya editor bisa menandai kotak yang salah.

Web memakai skema yang sama untuk validasi form sebelum mengirim. Server tetap memvalidasi ulang.

## 3. Auth: login Google

### Konfigurasi

| Nama | Jenis | Lokal (`.dev.vars`) | Produksi |
|---|---|---|---|
| `APP_ORIGIN` | var | `http://localhost:5173` | `vars` di wrangler.jsonc: `https://sorak.helpu.workers.dev` |
| `GOOGLE_CLIENT_ID` | var | ID client | `vars` di wrangler.jsonc (ID client memang publik) |
| `GOOGLE_CLIENT_SECRET` | secret | nilai rahasia | `wrangler secret put`, dijalankan Surya |
| `JWT_SECRET` | secret | string acak 32 byte | `wrangler secret put`, dijalankan Surya |

- `apps/api/.dev.vars.example` (masuk git) berisi nama kunci tanpa nilai.
- Saat startup route auth, env divalidasi dengan Zod. Kalau ada yang kosong, request auth gagal dengan `INTERNAL` dan log yang menyebut nama kunci yang hilang (bukan nilainya).

### Alur

1. **`GET /api/auth/google/start`**
   - Buat `state` (32 byte acak, base64url) dan `code_verifier` PKCE (32 byte acak, base64url).
   - Simpan keduanya di cookie `sorak_oauth`: HttpOnly, Secure, SameSite=Lax, Path=/api/auth, Max-Age `OAUTH_STATE_TTL_SEC`.
   - Redirect 302 ke `https://accounts.google.com/o/oauth2/v2/auth` dengan `client_id`, `redirect_uri = APP_ORIGIN + /api/auth/google/callback`, `response_type=code`, `scope=openid email profile`, `state`, `code_challenge` (SHA-256 dari verifier, base64url), `code_challenge_method=S256`, `prompt=select_account`.
2. **`GET /api/auth/google/callback?code&state`**
   - Tolak kalau cookie `sorak_oauth` tidak ada atau `state` tidak cocok. Cookie `sorak_oauth` selalu dihapus di langkah ini.
   - Tukar `code` ke `https://oauth2.googleapis.com/token`, dengan `code_verifier` dan `client_secret`.
   - Validasi respons token dengan Zod.
   - Ambil payload `id_token` dengan `decode` dari `hono/jwt`, lalu validasi klaimnya dengan Zod:
     - `iss` adalah `accounts.google.com` atau `https://accounts.google.com`;
     - `aud` sama dengan `GOOGLE_CLIENT_ID`;
     - `exp` belum lewat;
     - `email_verified === true`;
     - `sub`, `email`, `name` ada.
   - Tanda tangan `id_token` tidak perlu diverifikasi, karena token diterima langsung dari Google lewat TLS (OpenID Connect Core 3.1.3.7 butir 6). Tulis alasan ini di komentar.
   - Upsert host berdasarkan `(auth_provider='google', provider_subject=sub)`. Host baru dibuat dengan `display_name` dari `name` dipotong ke `DISPLAY_NAME_MAX_LENGTH`. Host lama: perbarui `email` dan `updated_at`.
   - Kalau email sudah dipakai host lain, redirect ke `/login?error=email_taken`.
   - Set cookie sesi lalu redirect 302 ke `/quizzes`.
   - Semua kegagalan lain redirect ke `/login?error=google_failed`, dan detailnya dicatat di log. Bukan JSON, karena yang membuka route ini adalah browser.
3. **Cookie sesi `sorak_session`**
   - JWT HS256 (`sign` / `verify` dari `hono/jwt`, algoritma ditulis eksplisit) dengan payload `{ sub: hostId, sv: session_version, exp }`.
   - Atribut cookie: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age `SESSION_TTL_SEC`.
4. **Middleware `requireHost`** untuk semua route yang butuh login:
   - verifikasi JWT;
   - baca `hosts` berdasarkan `sub`;
   - cocokkan `sv` dengan `session_version`.
   - Gagal di langkah mana pun: 401 `UNAUTHENTICATED`.
   - Host yang ditemukan disimpan di context Hono (`c.set("host", …)`) dengan tipe yang jelas.
5. **`GET /api/me`** mengembalikan `Host`, atau 401.
6. **`POST /api/auth/logout`** menghapus cookie sesi dan mengembalikan 204.
   - Token yang sudah dicuri tetap berlaku sampai `exp`. Ini risiko yang diterima; tombol "keluar dari semua perangkat" (menaikkan `session_version`) belum dibuat.
7. **CSRF**: middleware `csrf` dari `hono/csrf` dengan `origin: APP_ORIGIN` untuk semua `/api/*`. Ini lapisan kedua di atas SameSite=Lax.

Catatan lokal: Vite mem-proxy `/api` tanpa mengubah header Host, jadi cookie dan redirect bekerja di `http://localhost:5173`. Chrome dan Firefox menerima cookie `Secure` di `localhost`.

## 4. API kuis

Semua route di bawah memakai `requireHost`. Setiap query memfilter `host_id` milik host yang login. Kuis milik host lain diperlakukan seperti tidak ada: **404, bukan 403**, supaya orang tidak bisa menebak id mana yang ada. Ubah baris "403 bukan pemilik" di `.claude/rules/api.md` agar sesuai.

| Route | Body | Respons |
|---|---|---|
| `GET /api/quizzes` | - | 200 `QuizSummary[]`, urut `updated_at` terbaru, maksimal `QUIZ_LIST_LIMIT` |
| `POST /api/quizzes` | `QuizInput` | 201 `QuizDetail` |
| `GET /api/quizzes/:id` | - | 200 `QuizDetail` atau 404 |
| `PUT /api/quizzes/:id` | `QuizInput` | 200 `QuizDetail` atau 404 |
| `DELETE /api/quizzes/:id` | - | 204 atau 404 |

- `:id` divalidasi `QuizId`. Id yang bukan UUID langsung 404.
- `bodyLimit` dari `hono/body-limit` sebesar `QUIZ_BODY_MAX_BYTES` untuk POST dan PUT; kalau terlampaui, 413 `PAYLOAD_TOO_LARGE`.
- Pemetaan baris ke objek ada di satu tempat per tabel (`toQuizSummary`, `toQuestionDetail`). Kolom `options` (JSON di D1) di-parse lalu divalidasi dengan `Options`.

### PUT = ganti seluruh isi kuis

Editor selalu mengirim kuis utuh. Server mengganti seluruh daftar soal dalam satu `env.DB.batch`, jadi semuanya masuk atau semuanya batal:

1. Cek kepemilikan dan ambil `id, created_at, origin` soal yang sekarang ada di kuis itu.
2. Lalu jalankan dalam satu batch:
   - `UPDATE quizzes … WHERE id = ? AND host_id = ?`
   - `DELETE FROM questions WHERE quiz_id = ?`
   - satu `INSERT` per soal, dengan `position` sesuai urutan array.
3. Soal yang `id`-nya memang milik kuis ini mempertahankan `id`, `created_at`, dan `origin`. `id` lain (kosong, atau milik kuis lain) diganti `crypto.randomUUID()`. Jangan pernah memakai id dari klien yang bukan milik kuis ini.

Kenapa hapus lalu tulis ulang, bukan update per baris: `UNIQUE (quiz_id, position)` membuat penukaran urutan soal bentrok kalau di-update satu per satu. Harganya kuota tulis: menyimpan 50 soal sekitar 300 baris tulis (termasuk indeks), dari jatah 100.000 per hari. Catat `rows_written` di log. Optimasi diff ditunda sampai angkanya terbukti jadi masalah.

Dua host yang menyimpan kuis yang sama bersamaan tidak mungkin, karena kuis hanya milik satu host. Dua tab milik host yang sama: penyimpanan terakhir yang menang. Risiko ini diterima.

### Query yang wajib dicek `EXPLAIN QUERY PLAN`

- Daftar kuis: `WHERE host_id = ? ORDER BY updated_at DESC` harus memakai `quizzes_host_updated_idx`.
- Soal per kuis: `WHERE quiz_id = ? ORDER BY position` harus memakai indeks unik `(quiz_id, position)`.
- Jumlah soal per kuis di halaman daftar memakai subquery `COUNT(*)` pada indeks yang sama.

Laporkan hasilnya di ringkasan fase.

## 5. Seed lokal

- File `apps/api/seed/local.sql` dan script `pnpm --filter api db:seed:local`. Flag `--local` ditulis mati di script, tanpa varian remote.
- Seed memberi "Kuis Demo Sorak" berisi 10 soal (pengetahuan umum Indonesia, 2–4 opsi, waktu bervariasi, sebagian punya `explanation`) ke **setiap host lokal yang belum punya kuis itu**.
- Seed idempoten: dijalankan berkali-kali tidak menggandakan data. Cara pakai: login Google di lokal sekali, lalu jalankan seed.
- Id dibuat di SQL dengan format UUID v4, supaya lolos validasi `z.uuid()`.
- Test: seed dijalankan dua kali pada D1 test, dan hasilnya tetap satu kuis dengan 10 soal yang lolos `QuizDetail`.

## 6. Web

Dependensi baru yang sudah disetujui: `react-router`. Tidak ada library form atau UI.

| Halaman | Isi |
|---|---|
| `/login` | Tombol "Masuk dengan Google" berupa navigasi biasa ke `/api/auth/google/start` (bukan fetch). Pesan error dari `?error=`. |
| `/quizzes` | Daftar kuis (judul, jumlah soal, terakhir diubah), tombol "Kuis baru", hapus dengan konfirmasi, tombol keluar. |
| `/quizzes/new`, `/quizzes/:id` | Editor kuis (detail di bawah). |

Editor kuis berisi:

- judul dan deskripsi;
- daftar soal: tambah, hapus, naik, turun;
- per soal: pertanyaan, 2–4 opsi, pilih jawaban benar (radio), batas waktu, penjelasan opsional.

Perilaku halaman:

- Halaman selain `/login` memanggil `/api/me` dulu. Kalau 401, pindah ke `/login`.
- Tombol "Simpan": `/quizzes/new` memakai POST lalu pindah ke `/quizzes/:id`; halaman yang sudah punya id memakai PUT.
- Validasi dengan `QuizInput` dari `@sorak/shared` sebelum mengirim. Error per kotak, dari Zod lokal maupun `fields` server, ditampilkan di bawah kotaknya.
- Satu modul `api.ts` (nama sesuai isi) untuk fetch: `credentials: "same-origin"`, respons divalidasi dengan skema shared, error `ApiError` dilempar sebagai error bertipe.
- Tampilan fungsional saja, memakai CSS biasa. Polesan desain di Hari 5. Tetap layak dipakai di layar HP 360 px.

## 7. Test minimum

Test Worker memakai `@cloudflare/vitest-pool-workers` (dependensi baru yang sudah disetujui), dengan D1 asli lokal dan migrasi diterapkan sebelum test.

- **shared**:
  - `QuestionInput` menolak `correctIndex` di luar jumlah opsi, 1 opsi, 5 opsi, dan prompt kosong;
  - `QuizInput` menolak 51 soal.
- **auth**:
  - `start`: redirect berisi parameter yang benar dan menyetel cookie `sorak_oauth`;
  - `callback`: menolak state yang tidak cocok;
  - `callback`: menolak `aud` salah dan `email_verified` false;
  - `callback`: sukses membuat host baru, dan login kedua tidak membuat host ganda;
  - endpoint token Google di-mock dengan cara yang dianjurkan dokumentasi versi `vitest-pool-workers` yang terpasang.
- **sesi**:
  - tanpa cookie: 401;
  - JWT dengan tanda tangan salah: 401;
  - `sv` tidak cocok: 401;
  - logout menghapus cookie.
- **kuis**:
  - CRUD lengkap;
  - kuis host lain: 404 untuk GET, PUT, DELETE;
  - body tidak valid: 400 dengan `fields`;
  - PUT mempertahankan id soal lama;
  - PUT mengganti id yang milik kuis lain;
  - menukar urutan soal tidak bentrok;
  - DELETE ikut menghapus soal;
  - body di atas batas: 413.
- **seed**: idempoten (lihat bagian 5).

## 8. Ukur CPU setelah Surya deploy

- Tambahkan `"observability": { "enabled": true }` di `apps/api/wrangler.jsonc` supaya Workers Logs mencatat CPU time tiap request. Cek dulu di dokumentasi Cloudflare bahwa ini tersedia di Free plan, dan berapa batas lognya.
- Yang diukur:
  - `GET /api/auth/google/callback`;
  - `PUT /api/quizzes/:id` dengan 50 soal penuh;
  - `GET /api/quizzes`.
- Targetnya, semua jauh di bawah 10 ms. Kalau PUT 50 soal mendekati 10 ms, laporkan; jangan langsung mengoptimasi.

## 9. ADR yang ditulis hari ini

- `0002-workers-dan-d1.md`: kenapa D1, dibandingkan Postgres gratisan (Supabase/Neon) dan SQLite di Durable Object, untuk data permanen. Acuannya kuota Free, latensi dari Indonesia, dan satu ekosistem.
- `0003-login-google-bukan-password.md`: isi bagian 1 spec ini, beserta pilihan yang ditolak:
  - PBKDF2 100k (23 ms, melewati batas);
  - PBKDF2 diturunkan (lemah);
  - hash di Durable Object (memindahkan masalah dan memakan kuota DO);
  - magic link lewat email (butuh layanan email).

## 10. Di luar cakupan Hari 1

- Rate limit login (Hari 2).
- Upload gambar soal (`image_url` tetap null).
- Soal dari AI dan `origin = 'ai_edited'`.
- Tombol keluar dari semua perangkat.
- Polesan desain.
