# ai-eval

Evaluasi offline draf soal AI (F-10). Skrip ini memakai `buildTextPrompt`, `parseDrafts`, dan request Groq yang sama persis dengan Worker (`apps/api/src/ai`), lalu mengukur:

- persen output yang lolos validasi skema (target ≥ 90%);
- persen soal grounded (buktinya benar-benar ada di materi);
- latency p50 dan p95, serta rata-rata token;
- hasil materi prompt injection (`06-ekonomi-permintaan-penawaran`): soalnya tetap tentang materi atau tidak.

Materi di `materials/` ditulis sendiri untuk evaluasi ini, bukan disalin dari buku paket.

## Menjalankan

Butuh Node 22.6 atau lebih baru: skrip TypeScript dijalankan langsung, tanpa build.

```powershell
# Uji alur tanpa memanggil Groq (output dan jam palsu, selesai dalam hitungan detik)
pnpm --filter ai-eval run eval --dry-run

# Evaluasi sungguhan: 10 materi × 3 percobaan × 10 soal = 30 permintaan
$env:GROQ_API_KEY = "<key Groq>"
pnpm --filter ai-eval run eval
Remove-Item Env:GROQ_API_KEY
```

Opsi: `--runs=3`, `--count=5|10`, `--only=01,06` (awalan nama file materi). Model diambil dari `GROQ_TEXT_MODEL` di `apps/api/wrangler.jsonc`, atau dari variabel environment dengan nama yang sama.

Key hanya dikirim ke header Authorization, tidak pernah dicetak atau ditulis ke hasil.

## Batas Groq Free plan

8.000 token per menit adalah batas tersempit, dan satu permintaan 10 soal sekitar 4.000–5.000 token. Skrip membaca header `x-ratelimit-remaining-tokens` dan `x-ratelimit-reset-tokens`, lalu menunggu sebelum permintaan berikutnya kalau sisa token tidak cukup. Kalau tetap kena 429, skrip menunggu sesuai `retry-after`, lalu mengulang permintaan yang sama. Akibatnya evaluasi penuh berjalan sekitar 15–25 menit, dan memakai sekitar 130.000 dari 200.000 token per hari.

## Hasil

`results/<tanggal>-<versi prompt>.json` (detail setiap percobaan) dan `.md` (ringkasan, tabel per materi, hasil injeksi, dan 5 soal acak dengan baris "Catatan Surya" untuk dinilai manusia). Hasil `--dry-run` diberi akhiran `-dry-run` dan tidak di-commit.

Naikkan `AI_PROMPT_VERSION` di `packages/shared` setiap kali prompt berubah, lalu jalankan ulang evaluasi.
