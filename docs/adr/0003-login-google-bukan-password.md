# ADR 0003: Login host lewat Google, bukan password

- Status: diterima
- Tanggal: 2026-10-08

## Konteks

Rencana awal: host login dengan email + password yang di-hash PBKDF2-SHA256 lewat WebCrypto. Saat diuji di Workers:

- Workers menolak PBKDF2 di atas 100.000 iterasi (`NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported`).
- Pada 100.000 iterasi, satu hash memakan sekitar 23 ms CPU. Batas Workers Free 10 ms CPU per request.
- OWASP menyarankan 600.000 iterasi untuk PBKDF2-SHA256. Menurunkan iterasi supaya muat 10 ms membuat hash jauh lebih mudah dibobol kalau database bocor.

Fakta pendukung:

- Hampir semua guru di Indonesia punya akun Google (Gmail, atau belajar.id yang memakai Google Workspace).
- Skema D1 (`0001_init.sql`) sudah mendukung `auth_provider = 'google'` dan `provider_subject`.
- Menunggu Google adalah I/O, jadi tidak dihitung sebagai CPU.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. PBKDF2 100.000 iterasi | Sesuai rencana awal; tanpa layanan luar. | Sekitar 23 ms CPU per login, melewati batas 10 ms; request login bisa dihentikan runtime. |
| B. PBKDF2 dengan iterasi diturunkan agar muat 10 ms | Muat di batas CPU. | Jauh di bawah saran OWASP; kalau database bocor, password guru (yang sering dipakai ulang di tempat lain) mudah dibobol. |
| C. Hash di Durable Object | Durable Object punya batas CPU berbeda. | Memindahkan masalah, bukan menyelesaikannya: kode hash tetap sama beratnya, menambah hop jaringan, dan memakan kuota Durable Object yang dibutuhkan GameRoom. |
| D. Magic link lewat email | Tanpa password. | Butuh layanan kirim email (akun, rahasia, kuota, risiko masuk spam), dan guru harus pindah ke aplikasi email setiap login. |
| E. Login Google (OAuth 2.0 / OpenID Connect) | Tidak ada password yang disimpan. Worker tidak menghitung hash apa pun. Guru cukup memilih akun yang sudah login di HP/laptop. | Bergantung pada Google; guru tanpa akun Google tidak bisa jadi host. Butuh OAuth client di Google Cloud Console. |

## Keputusan

Pilihan E. Host login hanya lewat Google dengan alur authorization code + PKCE (S256) dan `state` di cookie sekali pakai. Server menukar `code` langsung ke endpoint token Google, memvalidasi klaim `id_token` (`iss`, `aud`, `exp`, `email_verified`) dengan Zod, lalu menerbitkan cookie sesi sendiri: JWT HS256 berisi `{ sub, sv, exp }`, `HttpOnly; Secure; SameSite=Lax`, umur 7 hari. Setiap request terlindungi mencocokkan `sv` dengan `hosts.session_version`.

Tanda tangan `id_token` tidak diverifikasi karena token diterima langsung dari Google lewat TLS, bukan dari browser (OpenID Connect Core 1.0, 3.1.3.7 butir 6).

## Konsekuensi

- Kolom `password_hash` tetap ada di skema tapi tidak dipakai, karena migrasi yang sudah diterapkan tidak boleh diubah.
- `GOOGLE_CLIENT_SECRET` dan `JWT_SECRET` hanya di `wrangler secret` dan `.dev.vars`. Mengganti `JWT_SECRET` mengeluarkan semua host sekaligus.
- Token sesi yang dicuri tetap berlaku sampai `exp` (paling lama 7 hari). Tombol "keluar dari semua perangkat" (menaikkan `session_version`) belum dibuat; risiko ini diterima untuk pilot.
- Email yang sudah dipakai host lain ditolak (`/login?error=email_taken`), karena kolom `email` unik.
- Rate limit login ditunda ke Hari 2.
