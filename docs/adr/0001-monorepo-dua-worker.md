# ADR 0001: Monorepo dengan dua Worker

- Status: diterima
- Tanggal: 2026-10-01

## Konteks

Sorak punya tiga bagian: aplikasi web (React), API (REST, auth, AI), dan GameRoom (Durable Object yang memegang game live). Semua harus berjalan di Cloudflare Workers Free tanpa domain sendiri, jadi alamat yang tersedia hanya subdomain `*.workers.dev` dan `*.pages.dev`.

Dua fakta membentuk keputusan ini:

1. Deploy kode baru me-restart Durable Object di Worker itu, sehingga semua WebSocket ke GameRoom terputus. Memperbaiki satu warna tombol tidak boleh memutus 36 siswa yang sedang bermain.
2. Kalau web dan API berada di domain berbeda (`sorak.pages.dev` dan `sorak.workers.dev`), browser memperlakukannya sebagai lintas situs. Cookie login perlu `SameSite=None`, perlu CORS, dan browser seperti Safari dapat memblokir cookie pihak ketiga.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. Pages untuk web, satu Worker untuk API + GameRoom | Pola klasik | Dua domain (masalah cookie dan CORS); deploy API memutus game |
| B. Satu Worker untuk aset web + API + GameRoom | Satu domain, satu deploy | Setiap deploy, termasuk perubahan CSS, memutus semua game |
| C. Worker `sorak` (aset web + API) dan Worker `sorak-realtime` (GameRoom) | Satu domain untuk browser; deploy UI/API tidak memutus game | Dua file konfigurasi wrangler; binding Durable Object lintas Worker |

## Keputusan

Pilihan C. Satu repo (monorepo) dengan folder `apps/web`, `apps/api`, `apps/realtime`, `packages/shared`, dan `tools/loadtest`.

- `sorak` menyajikan hasil build `apps/web/dist` sebagai static assets dengan mode single-page application. Hanya `/api/*` dan `/ws/*` yang menjalankan kode Worker (`run_worker_first`), sehingga file HTML, JS, dan gambar disajikan gratis tanpa menghitung kuota request.
- `sorak` memanggil GameRoom lewat binding Durable Object yang menunjuk `script_name = "sorak-realtime"`.
- `sorak-realtime` hanya di-deploy kalau logika game berubah, dan tidak pernah saat pilot berjalan.
- Di lokal, keduanya dijalankan dalam satu perintah `wrangler dev -c apps/api/wrangler.jsonc -c apps/realtime/wrangler.jsonc`.

## Konsekuensi

- Browser hanya melihat satu alamat, jadi cookie `SameSite=Lax` cukup dan CORS tidak dibutuhkan.
- Urutan deploy pertama: `sorak-realtime` dulu (supaya class GameRoom ada), baru `sorak`.
- Perubahan di `packages/shared` yang menyentuh protokol bisa membutuhkan deploy keduanya; `PROTOCOL_VERSION` menjaga agar versi yang tidak cocok ketahuan.
- Dokumen System Design yang menyebut Cloudflare Pages diperbarui untuk mengikuti keputusan ini.
- `compatibility_date` kedua Worker sengaja mengikuti batas workerd bawaan `@cloudflare/vitest-pool-workers` (saat ini 2026-08-22 untuk versi 0.22.0), supaya test dan produksi memakai perilaku runtime yang sama. Tanggal ini dinaikkan bersama setiap kali pool-workers rilis versi baru, dan kedua Worker di-deploy ulang karenanya. Flag yang tertinggal saat diputuskan (2026-10-03): `durable_object_io_tasks_prevent_eviction` (default 2026-10-01), yang belum dipakai kode GameRoom.
