-- 0002: metrik draf soal AI dari pemakaian nyata (Hari 6).
-- grounded_count: berapa soal yang buktinya benar-benar ada di materi (grounding check); NULL untuk status selain ok.
-- prompt_version: versi prompt (AI_PROMPT_VERSION), supaya hasil sebelum dan sesudah prompt berubah bisa dibandingkan.
ALTER TABLE ai_generations ADD COLUMN grounded_count INTEGER CHECK (grounded_count IS NULL OR grounded_count >= 0);
ALTER TABLE ai_generations ADD COLUMN prompt_version TEXT;
