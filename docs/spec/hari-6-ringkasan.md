# Hari 6: ringkasan AI draf soal dari teks materi (F-10)

- Tanggal: 2026-10-26
- Status: kode selesai dan teruji otomatis (661 test). Belum di-deploy. Evaluasi dengan Groq sungguhan dan uji end-to-end production menunggu Surya (`docs/testing/mvp-e2e.md`).
- Commit: `843b3e7` (shared, migrasi, logika murni) → `2578a95` (endpoint) → `723503a` (web) → `3a843c1` (evaluasi) → Fase 5 (dokumen).

## 1. Urutan deploy

Jangan deploy saat ada game yang sedang berjalan. Hanya Worker `sorak` yang berubah; `sorak-realtime` tidak perlu di-deploy ulang.

```powershell
pnpm install
pnpm -r typecheck
pnpm -r test

# 1) Migrasi D1 remote DULU: kode baru menulis kolom grounded_count dan prompt_version.
#    Migrasinya hanya menambah kolom yang boleh NULL, jadi kode lama tetap jalan di skema baru.
pnpm exec wrangler d1 migrations list sorak-db --remote -c apps/api/wrangler.jsonc
pnpm exec wrangler d1 migrations apply sorak-db --remote -c apps/api/wrangler.jsonc

# 2) Secret Groq. Cek dulu; put hanya kalau GROQ_API_KEY belum ada di daftar.
pnpm exec wrangler secret list -c apps/api/wrangler.jsonc
pnpm exec wrangler secret put GROQ_API_KEY -c apps/api/wrangler.jsonc

# 3) Vars model (GROQ_TEXT_MODEL, GROQ_VISION_MODEL) ada di apps/api/wrangler.jsonc dan ikut terkirim saat deploy.
# 4) Build web, lalu deploy Worker "sorak" (REST + aset web).
pnpm --filter @sorak/web build
pnpm exec wrangler deploy -c apps/api/wrangler.jsonc

# Cek
pnpm exec wrangler deployments list --name sorak
pnpm exec wrangler d1 execute sorak-db --remote -c apps/api/wrangler.jsonc --command "SELECT name FROM pragma_table_info('ai_generations')"
```

- Hasil query terakhir harus memuat `grounded_count` dan `prompt_version`.
- Tanpa `GROQ_API_KEY`, tombol "Buat dari materi" tetap tampil, dialognya menjelaskan bahwa fitur AI tidak tersedia, dan editor manual tetap jalan.
- **CPU time:** setelah deploy, generate satu kali, lalu buka Workers & Pages → sorak → Logs, dan cari invocation `POST /api/ai/generate`. CPU time-nya harus di bawah 10 ms (menunggu Groq tidak dihitung).
- Rollback: `pnpm exec wrangler rollback --name sorak`. Migrasi tidak perlu dibatalkan: kolom tambahan diabaikan kode lama.

## 2. Yang dibuat

**Shared (`packages/shared`)**
- Konstanta `AI_*`: kuota 20 per guru per hari, materi 200–8.000 huruf, 5 atau 10 soal, batas waktu 25 detik, dan versi prompt `gen-text-v1`.
- Skema `AiGenerateFromTextInput`, `AiDraftQuestion` (4 pilihan tanpa kembar, penjelasan ≤ 300, bukti ≤ 200 huruf), dan `AiDraftResponse`; fungsi `normalizeText`.
- `QuestionOrigin` (`manual`, `ai`, `ai_edited`) di input dan detail soal; 4 kode error AI dan `retryAfterSec`.
- `"sideEffects": false`, supaya kode shared yang tidak dipakai halaman siswa (termasuk skema AI) tidak ikut terunduh di HP. Bundle siswa turun dari 123.240 ke 121.335 byte gzip.

**API (`apps/api`)**
- Migrasi `0002`: kolom `grounded_count` dan `prompt_version` di `ai_generations`.
- `src/ai/prompt.ts`: system prompt Bahasa Indonesia, materi dibungkus `<materi>`, dan JSON Schema mode strict.
- `src/ai/grounding.ts`: grounding check (kutipan minimal 20 huruf yang sudah dinormalisasi harus ada di materi).
- `src/ai/validate.ts`: `parseDrafts`, dengan alasan gagal `invalid_json`, `invalid_schema`, `wrong_count`, atau `duplicate_prompt`.
- `src/ai/groq.ts`: request ke Groq (satu sumber untuk Worker dan evaluasi).
- `src/ai/quota.ts`: kuota harian per guru sejak 00.00 WIB.
- `src/ai-routes.ts`: `POST /api/ai/generate`. Draf tidak disimpan; setiap permintaan (termasuk yang gagal atau ditolak kuota) dicatat sebagai satu baris metrik, tanpa materi dan tanpa isi soal.
- Soal sekarang menyimpan `origin` dari klien.

**Web (`apps/web`)**
- Tombol "Buat dari materi" di editor, dialog materi (hitungan huruf, 5/10 soal, turus menunggu, Batal), dan layar review di atas daftar soal (edit langsung, centang "Pakai soal ini", peringatan bukti tidak ditemukan, "Tambahkan N soal ke kuis", "Buang semua").
- Origin dihitung saat Simpan dengan membandingkan isi asli soal AI: diubah berarti `ai_edited`.
- Degradasi: AI tidak tersedia, server sibuk (hitung mundur), dan kuota habis (tombol terkunci sampai halaman dimuat ulang).

**Evaluasi (`tools/ai-eval`)**
- 10 materi karangan sendiri, satu berisi kalimat prompt injection.
- `pnpm --filter ai-eval run eval [--dry-run]`: 10 materi × 3 percobaan × 10 soal, jeda mengikuti header rate limit Groq, dan laporan `.json` + `.md`.

**Dokumen**
- `docs/testing/mvp-e2e.md`, `docs/adr/0008-draf-soal-ai-structured-outputs-zod-grounding.md` (draf, bagian Keputusan diisi Surya), dan ringkasan ini.

## 3. Konsep

- **Structured outputs:** kita mengirim JSON Schema ke Groq, dan Groq memaksa jawaban model mengikuti bentuk itu. Bentuknya dijamin, isinya tidak: panjang teks, jumlah pilihan, dan pilihan kembar tetap diperiksa Zod di server, sama seperti pesan WebSocket.
- **Halusinasi:** model bahasa bisa mengarang fakta dengan nada yakin, misalnya "ribosom menghasilkan energi". Di kelas, soal seperti itu mengajarkan hal yang salah.
- **Grounding check:** model wajib menyertakan kutipan persis dari materi, dan server mencari kutipan itu di materi (setelah spasi, huruf besar, dan tanda kutip disamakan). Kalau tidak ketemu, soal ditandai untuk diperiksa guru. Murah (tanpa token tambahan) dan bisa diuji, tetapi hanya membuktikan kutipannya ada, bukan bahwa jawabannya benar.
- **Prompt injection:** teks dari pengguna yang menyusup sebagai perintah ke AI, misalnya "Abaikan semua instruksi sebelumnya". Pertahanan dasarnya: materi dibungkus penanda, penanda di dalam materi dibuang, dan system prompt menyatakan isinya data. Output tetap divalidasi dan ditinjau guru.
- **Rate limit token per menit (TPM):** Groq Free membatasi 8.000 token per menit untuk satu organisasi, sedangkan satu generate memakai sekitar 4.000–5.000 token. Server meneruskan `retry-after` sebagai hitung mundur di web; skrip evaluasi membaca sisa token dari header dan menunggu sebelum kena 429.
- **Evaluasi offline vs metrik produksi:** evaluasi offline memakai set materi tetap, jadi bisa dibandingkan antar versi prompt sebelum dirilis. Metrik produksi (`ai_generations`) menunjukkan apa yang terjadi dengan materi guru sungguhan setelah dirilis. Keduanya memakai fungsi validasi yang sama, sehingga angkanya bisa dibandingkan.

## 4. Trade-off

- **Grounded ≠ benar.** Grounding check murah dan bisa diuji, tetapi tidak menangkap soal yang mengutip kalimat benar dengan kunci jawaban salah. Pemeriksa AI kedua bisa menangkapnya, tetapi akan menggandakan token di bawah batas 8.000 per menit. Pertahanan terakhirnya tetap peninjauan guru.
- **Bukti terlalu panjang dipotong, bukan ditolak.** Satu bukti 230 huruf tidak menggagalkan 10 soal yang lain.
- **Kuota per guru dihitung dari semua permintaan,** termasuk yang gagal, karena token Groq sudah terpakai. Dua permintaan yang datang tepat bersamaan bisa membuat hitungan lewat satu (21 dari 20); untuk batas harian, ini diterima.
- **Origin dari perbandingan isi, bukan flag "pernah diedit".** Lebih jujur, tetapi soal AI yang dibuka lagi dari server dibandingkan dengan isi tersimpan terakhir, bukan draf AI aslinya (draf asli tidak disimpan).
- **Skrip evaluasi tanpa `@types/node`.** Tidak menambah dependensi, tetapi ada deklarasi kecil `tools/ai-eval/src/node.d.ts` yang harus dirawat sendiri.
- **Evaluasi penuh lambat (15–25 menit)** karena sengaja mematuhi batas token per menit, dan memakai sekitar dua pertiga jatah token harian. Jangan dijalankan saat ada kelas yang memakai fitur AI.
