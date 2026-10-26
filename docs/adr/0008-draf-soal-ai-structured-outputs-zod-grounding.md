# ADR 0008: Draf soal AI: Structured Outputs, validasi Zod, dan grounding check

- Status: diusulkan
- Tanggal: 2026-10-26

## Konteks

F-10: guru menempel teks materi (200–8.000 huruf) dan mendapat 5 atau 10 draf soal pilihan ganda untuk ditinjau. Acceptance criteria: minimal 90% output lolos validasi skema pada set evaluasi, dan soal tidak terpakai sebelum host menyetujui. Risiko PRD yang harus dijawab: "Output AI salah atau mengarang → soal keliru dipakai di kelas".

Angka dan batasan (dicek di console.groq.com/docs, 26 Oktober 2026):
- **Model:** Llama 4 Scout di PRD sudah dihentikan Groq pada 17 Juli 2026. Pengganti untuk teks adalah `openai/gpt-oss-120b`, yang mendukung Structured Outputs mode strict. ID model disimpan di `vars` (`GROQ_TEXT_MODEL`), bukan di kode.
- **Groq Free plan per organisasi:** 30 permintaan per menit, 1.000 per hari, **8.000 token per menit**, dan 200.000 token per hari. Satu permintaan 10 soal sekitar 4.000–5.000 token, jadi setiap permintaan tambahan (misalnya "AI kedua memeriksa AI pertama") langsung memotong kapasitas jadi separuhnya.
- **Mode strict:** semua properti wajib ada di `required`, setiap objek `additionalProperties: false`. Kata kunci panjang dan jumlah (`maxLength`, `minItems`, `maxItems`) tidak tercantum sebagai yang didukung. Mode ini tidak bisa digabung dengan streaming atau tool use.
- **Worker:** CPU 10 ms per request. Menunggu Groq adalah I/O dan tidak dihitung; parse dan validasi beberapa KB JSON yang dihitung.
- Prinsip dari Hari 2: data dari luar tidak dipercaya, termasuk dari AI.

## Pilihan

| Pilihan | Untung | Rugi |
|---|---|---|
| A. Prompt saja ("jawab dalam JSON"), lalu `JSON.parse` | Paling sederhana; bisa dipakai model apa pun. | JSON rusak dan field hilang sering terjadi; tanpa validasi, soal dengan 3 pilihan atau `correctIndex` 7 bisa masuk ke editor. |
| B. Structured Outputs strict, tanpa validasi tambahan | Bentuk JSON dijamin penyedia. | Panjang teks, jumlah pilihan, pilihan kembar, dan jumlah soal tidak bisa dibatasi lewat schema; kepercayaan penuh pada penyedia dan model yang bisa berganti. |
| C. Structured Outputs strict + validasi Zod di server (skema yang sama dengan web) + grounding check (kutipan bukti dicari di materi) | Bentuk dijamin penyedia, isi dijamin Zod (4 pilihan, tidak kembar, panjang, jumlah soal, tidak ada soal kembar). Halusinasi yang paling mudah dideteksi (bukti yang tidak ada di materi) ditandai tanpa biaya token tambahan, murni string matching. | Grounding check hanya membuktikan kutipan ada di materi, bukan bahwa jawabannya benar. Kutipan yang diparafrasekan model ditandai tidak grounded walau soalnya benar (false negative). |
| D. C ditambah pemeriksa AI kedua (LLM-as-judge) untuk setiap draf | Bisa menilai kebenaran jawaban, bukan hanya keberadaan kutipan. | Minimal dua kali lipat token per generate; dengan 8.000 token per menit, praktis hanya satu guru per menit. Pemeriksanya juga bisa salah, jadi guru tetap harus meninjau. |
| E. Tool use / function calling untuk memaksa bentuk | Didukung banyak model. | Di Groq tidak bisa digabung dengan mode strict, dan tidak menambah apa pun di atas C untuk satu panggilan tanpa alat. |

## Keputusan

## Konsekuensi

**Yang menjadi lebih mudah**
- **Satu sumber aturan.** `AiDraftQuestion` di `@sorak/shared` dipakai server (validasi output) dan web (tipe layar review); batas yang tidak bisa dinyatakan JSON Schema (`maxLength`, jumlah pilihan, pilihan kembar) ditegakkan Zod.
- **Kegagalan punya nama.** `parseDrafts` mengembalikan `invalid_json`, `invalid_schema` (dengan path Zod), `wrong_count`, atau `duplicate_prompt`. Alasan ini masuk log `ai_generate` dan laporan evaluasi, sehingga perbaikan prompt bisa diarahkan.
- **Bisa diukur di dua tempat.** Evaluasi offline (`tools/ai-eval`, 10 materi × 3 percobaan) memakai fungsi yang sama persis dengan Worker. Di produksi, tabel `ai_generations` mencatat status, `grounded_count`, `prompt_version`, token, dan latency, tanpa menyimpan materi atau isi soal.
- **Guru tetap yang memutuskan.** Draf tidak disimpan di endpoint; soal masuk kuis hanya lewat Simpan di editor. Draf yang tidak grounded tampil dengan peringatan dan tidak dicentang secara default.

**Yang menjadi lebih sulit**
- **Model terikat pada dukungan strict mode.** Mengganti model (misalnya kalau Groq menghentikan `gpt-oss-120b`) hanya bisa ke model yang juga mendukung Structured Outputs strict; kalau tidak ada, validasi Zod tetap menahan output rusak, tetapi persen lolos akan turun dan harus dievaluasi ulang.
- **Bukti yang lebih panjang dari 200 huruf dipotong**, bukan menggagalkan seluruh generate. Potongannya tetap kutipan, sehingga grounding check tetap berlaku, tetapi kutipan di layar review bisa terpotong.
- **Setiap perubahan prompt wajib menaikkan `AI_PROMPT_VERSION`** dan menjalankan ulang evaluasi, karena metrik produksi dikelompokkan per versi.

**Risiko yang sengaja diterima**
- **Grounded tidak sama dengan benar.** Soal bisa mengutip kalimat yang benar dari materi tetapi menandai pilihan yang salah sebagai jawaban. Pertahanan terakhirnya peninjauan guru, dan angka "disetujui tanpa edit" (`origin = 'ai'` dibanding `ai_edited`) dipantau setelah pilot.
- **Prompt injection hanya dipertahankan secara dasar:** materi dibungkus `<materi>…</materi>`, penanda di dalam materi dibuang, dan system prompt menyatakan isinya data, bukan instruksi. Ini menurunkan risiko, tidak menghilangkannya. Dampaknya terbatas karena output hanya berupa draf yang divalidasi skema dan ditinjau guru.
- **Kuota bisa kena di jam ramai.** Dengan 8.000 token per menit untuk semua guru, dua guru yang menekan tombol di menit yang sama bisa kena 429; web menampilkan hitung mundur dari `retryAfterSec`. Kuota 20 generate per guru per hari (dihitung sejak 00.00 WIB) mencegah satu guru menghabiskan jatah harian.
