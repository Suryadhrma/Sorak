import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AiGenerateFromTextInput,
  MAX_OPTIONS,
  MAX_QUESTIONS_PER_QUIZ,
  MIN_OPTIONS,
  TIME_LIMIT_MAX_SEC,
  TIME_LIMIT_MIN_SEC,
  fieldErrors,
} from "@sorak/shared";
import { AiMaterialDialog, AiReview, type AiCount } from "../AiDrafts.tsx";
import { AnswerTile, answerLetter } from "../AnswerOption.tsx";
import { CheckMark } from "../CheckMark.tsx";
import { AiRequestError, generateDrafts } from "../ai-api.ts";
import { aiReducer, appendSelected, initialAiState, roomLeft, toReviewDrafts } from "../ai-draft.ts";
import { ApiRequestError, createQuiz, describeError, getQuiz, updateQuiz } from "../api.ts";
import {
  draftFromQuiz,
  emptyQuizDraft,
  moveQuestion,
  newQuestionDraft,
  removeOption,
  validateDraft,
  type QuestionDraft,
  type QuizDraft,
  type SavedQuizState,
} from "../quiz-draft.ts";
import { useTheme } from "../theme.ts";

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "not_found" } | { kind: "error"; message: string };

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="field-error">
      {message}
    </p>
  );
}

/** Atribut untuk kotak isian yang punya pesan error di bawahnya. */
function invalidProps(errorId: string, message: string | undefined) {
  return message ? { "aria-invalid": true, "aria-describedby": errorId } : {};
}

export function QuizEditorPage() {
  useTheme("kertas");
  const { id } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>(id ? { kind: "loading" } : { kind: "ready" });
  const [draft, setDraft] = useState<QuizDraft>(emptyQuizDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Soal yang sedang diedit (fokus terakhir), ditandai kapur di daftar soal kiri.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Draf soal AI. Materi dan jumlah soal disimpan di sini supaya tidak hilang saat dialog ditutup lalu dibuka lagi.
  const [ai, dispatchAi] = useReducer(aiReducer, initialAiState);
  const [aiOpen, setAiOpen] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [aiCount, setAiCount] = useState<AiCount>(5);
  const [sourceError, setSourceError] = useState<string | undefined>(undefined);
  const [waitingRetry, setWaitingRetry] = useState(false);
  const aiRequest = useRef<AbortController | null>(null);

  useEffect(() => () => aiRequest.current?.abort(), []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getQuiz(id)
      .then((quiz) => {
        if (!active) return;
        setDraft(draftFromQuiz(quiz));
        setLoad({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
          setLoad({ kind: "not_found" });
          return;
        }
        setLoad({ kind: "error", message: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, [id]);

  function editDraft(patch: Partial<QuizDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    }));
  }

  // Error ditandai per nomor soal; begitu urutan soal berubah, nomornya tidak lagi menunjuk soal yang sama.
  function changeQuestionList(questions: QuestionDraft[]) {
    editDraft({ questions });
    setErrors({});
  }

  async function handleGenerate() {
    if (ai.quotaMessage) return;
    const input = AiGenerateFromTextInput.safeParse({ sourceText, count: aiCount });
    if (!input.success) {
      setSourceError(fieldErrors(input.error.issues).sourceText ?? "Materi belum valid.");
      return;
    }
    setSourceError(undefined);
    const controller = new AbortController();
    aiRequest.current = controller;
    dispatchAi({ type: "start" });
    try {
      const response = await generateDrafts(input.data, controller.signal);
      if (controller.signal.aborted) return;
      dispatchAi({ type: "succeeded", drafts: toReviewDrafts(response.drafts, () => crypto.randomUUID()) });
      setAiOpen(false);
    } catch (error) {
      // Batal: reducer sudah kembali ke idle, error abort tidak perlu ditampilkan.
      if (controller.signal.aborted) return;
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setSourceError(error.fields.sourceText);
      dispatchAi({
        type: "failed",
        code: error instanceof ApiRequestError ? error.code : null,
        message: describeError(error),
        retryAfterSec: error instanceof AiRequestError ? error.retryAfterSec : null,
        now: performance.now(),
      });
    } finally {
      if (aiRequest.current === controller) aiRequest.current = null;
    }
  }

  function cancelGenerate() {
    aiRequest.current?.abort();
    dispatchAi({ type: "cancel" });
  }

  function closeAiDialog() {
    cancelGenerate();
    setAiOpen(false);
  }

  function openAiDialog() {
    if (ai.flow.kind === "added") dispatchAi({ type: "dismiss" });
    setAiOpen(true);
  }

  function addAiDrafts() {
    if (ai.flow.kind !== "review") return;
    const selected = ai.flow.drafts.filter((item) => item.selected).length;
    const questions = appendSelected(draft.questions, ai.flow.drafts, () => crypto.randomUUID());
    const firstNumber = questions.length - selected + 1;
    changeQuestionList(questions);
    setActiveKey(questions[firstNumber - 1]?.key ?? null);
    dispatchAi({ type: "added", count: selected, firstNumber });
  }

  /** Berhasil: kembali ke Kuis saya, yang menampilkan "tersimpan" dan menyorot baris kuis ini. Gagal: tetap di sini. */
  async function handleSave() {
    setSaveError(null);
    const validation = validateDraft(draft);
    if (!validation.ok) {
      setErrors(validation.fields);
      setSaveError("Periksa kotak yang ditandai merah.");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = id ? await updateQuiz(id, validation.input) : await createQuiz(validation.input);
      navigate("/quizzes", { state: { savedQuizId: saved.id } satisfies SavedQuizState });
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(error.fields);
      if (error instanceof ApiRequestError && error.code === "UNAUTHENTICATED") {
        setSaveError("Sesi berakhir. Buka halaman masuk di tab baru, lalu simpan ulang.");
        return;
      }
      setSaveError(describeError(error));
    }
  }

  if (load.kind === "loading") return <p className="page-status" role="status">Memuat kuis…</p>;
  if (load.kind === "not_found") {
    return (
      <main className="page">
        <p role="alert">Kuis tidak ditemukan.</p>
        <Link to="/quizzes">Kembali ke daftar kuis</Link>
      </main>
    );
  }
  if (load.kind === "error") {
    return (
      <main className="page">
        <p className="alert" role="alert">
          {load.message}
        </p>
        <Link to="/quizzes">Kembali ke daftar kuis</Link>
      </main>
    );
  }

  return (
    <div className="buku">
      {/* Kepala menempel di atas layar supaya Simpan selalu terjangkau, berapa pun panjang kuisnya. */}
      <header className="buku-header editor-header">
        <nav className="editor-jejak" aria-label="Jejak halaman">
          <Link to="/quizzes">Kuis saya</Link>
          <span aria-hidden="true">/</span>
          <span className="editor-jejak-judul" aria-current="page">
            {draft.title.trim() || (id ? "Ubah kuis" : "Kuis baru")}
          </span>
        </nav>
        <div className="editor-simpan">
          {saveError && (
            <p className="alert" role="alert">
              {saveError}
            </p>
          )}
          <button type="button" className="button button-tinta" disabled={saving} onClick={handleSave}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </header>

      <div className="editor-tata">
        <nav className="editor-daftar" aria-label="Daftar soal">
          <p className="muted-strong">{draft.questions.length > 0 ? `${draft.questions.length} soal` : "Belum ada soal"}</p>
          {draft.questions.length > 0 && (
            <ol>
              {draft.questions.map((question, index) => (
                <li key={question.key}>
                  <a
                    href={`#soal-${index + 1}`}
                    aria-current={activeKey === question.key ? "location" : undefined}
                    onClick={() => setActiveKey(question.key)}
                  >
                    <span className="editor-daftar-nomor">{index + 1}</span>
                    <span className="editor-daftar-teks">{question.prompt.trim() || "Soal tanpa teks"}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </nav>

        <main className="buku-isi editor-isi">
          <h1 className="visually-hidden">{id ? "Ubah kuis" : "Kuis baru"}</h1>
          <div className="field">
            <label htmlFor="quiz-title">Judul</label>
            <input
              id="quiz-title"
              value={draft.title}
              onChange={(event) => editDraft({ title: event.target.value })}
              {...invalidProps("quiz-title-error", errors.title)}
            />
            <FieldError id="quiz-title-error" message={errors.title} />
          </div>

          <div className="field">
            <label htmlFor="quiz-description">Deskripsi, tidak wajib</label>
            <textarea
              id="quiz-description"
              rows={2}
              value={draft.description}
              onChange={(event) => editDraft({ description: event.target.value })}
              {...invalidProps("quiz-description-error", errors.description)}
            />
            <FieldError id="quiz-description-error" message={errors.description} />
          </div>

          <div className="ai-pembuka">
            <button type="button" className="button" onClick={openAiDialog} disabled={ai.flow.kind === "review"}>
              Buat dari materi
            </button>
            <p className="muted">
              {ai.flow.kind === "review"
                ? "Selesaikan draf di bawah dulu: tambahkan atau buang."
                : "Tempel teks pelajaran; AI menyusun draf soal untuk kamu periksa."}
            </p>
          </div>

          {aiOpen && (ai.flow.kind === "idle" || ai.flow.kind === "loading" || ai.flow.kind === "error") && (
            <AiMaterialDialog
              flow={ai.flow}
              quotaMessage={ai.quotaMessage}
              sourceText={sourceText}
              count={aiCount}
              sourceError={sourceError}
              waitingRetry={waitingRetry}
              onSourceText={(text) => {
                setSourceText(text);
                setSourceError(undefined);
              }}
              onCount={setAiCount}
              onGenerate={handleGenerate}
              onCancel={cancelGenerate}
              onClose={closeAiDialog}
              onWaitingRetry={setWaitingRetry}
            />
          )}

          {ai.flow.kind === "review" && (
            <AiReview
              drafts={ai.flow.drafts}
              room={roomLeft(draft.questions)}
              onEdit={(key, patch) => dispatchAi({ type: "edit", key, patch })}
              onAdd={addAiDrafts}
              onDiscard={() => dispatchAi({ type: "discard" })}
            />
          )}

          {ai.flow.kind === "added" && (
            <div className="ai-ditambah" role="status">
              <p className="notice">
                <CheckMark />
                {ai.flow.count} soal dari AI ditambahkan sebagai soal{" "}
                <span className="ai-ditambah-nomor">
                  {ai.flow.count === 1
                    ? ai.flow.firstNumber
                    : `${ai.flow.firstNumber}–${ai.flow.firstNumber + ai.flow.count - 1}`}
                </span>
                . Tekan Simpan supaya tersimpan.
              </p>
              <a href={`#soal-${ai.flow.firstNumber}`}>Lihat soalnya</a>
              <button type="button" className="button button-teks" onClick={() => dispatchAi({ type: "dismiss" })}>
                Tutup
              </button>
            </div>
          )}

          <ol className="question-list">
            {draft.questions.map((question, index) => {
              const path = `questions.${index}`;
              const fieldId = (name: string) => `${question.key}-${name}`;
              return (
                <li key={question.key} id={`soal-${index + 1}`} className="question-card" onFocus={() => setActiveKey(question.key)}>
                  <fieldset>
                    <legend>Soal {index + 1}</legend>

                    <div className="field">
                      <label htmlFor={fieldId("prompt")}>Pertanyaan</label>
                      <textarea
                        id={fieldId("prompt")}
                        className="editor-pertanyaan"
                        rows={2}
                        value={question.prompt}
                        onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                        {...invalidProps(fieldId("prompt-error"), errors[`${path}.prompt`])}
                      />
                      <FieldError id={fieldId("prompt-error")} message={errors[`${path}.prompt`]} />
                    </div>

                    <fieldset className="options">
                      <legend>Pilihan jawaban</legend>
                      {question.options.map((option, optionIndex) => {
                        const optionPath = `${path}.options.${optionIndex}`;
                        const letter = answerLetter(optionIndex);
                        const correct = question.correctIndex === optionIndex;
                        return (
                          <div key={optionIndex} className="option-row">
                            <AnswerTile index={optionIndex} />
                            <label htmlFor={fieldId(`option-${optionIndex}`)} className="visually-hidden">
                              Pilihan {letter}
                            </label>
                            <input
                              id={fieldId(`option-${optionIndex}`)}
                              placeholder={`Pilihan ${letter}`}
                              value={option}
                              onChange={(event) =>
                                updateQuestion(index, {
                                  options: question.options.map((text, i) => (i === optionIndex ? event.target.value : text)),
                                })
                              }
                              {...invalidProps(fieldId(`option-${optionIndex}-error`), errors[optionPath])}
                            />
                            <label className="tandai-benar">
                              <input
                                type="radio"
                                name={fieldId("correct")}
                                aria-label={`Jadikan pilihan ${letter} jawaban benar`}
                                checked={correct}
                                onChange={() => updateQuestion(index, { correctIndex: optionIndex })}
                              />
                              {correct && <CheckMark />}
                              {correct ? "Jawaban benar" : "Tandai benar"}
                            </label>
                            <button
                              type="button"
                              className="button button-teks"
                              aria-label={`Hapus pilihan ${letter}`}
                              disabled={question.options.length <= MIN_OPTIONS}
                              onClick={() => {
                                updateQuestion(index, removeOption(question, optionIndex));
                                setErrors({});
                              }}
                            >
                              Hapus
                            </button>
                            <FieldError id={fieldId(`option-${optionIndex}-error`)} message={errors[optionPath]} />
                          </div>
                        );
                      })}
                      <FieldError id={fieldId("options-error")} message={errors[`${path}.options`] ?? errors[`${path}.correctIndex`]} />
                      {question.options.length < MAX_OPTIONS && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => updateQuestion(index, { options: [...question.options, ""] })}
                        >
                          Tambah pilihan
                        </button>
                      )}
                    </fieldset>

                    <div className="field editor-waktu">
                      <label htmlFor={fieldId("time")}>Waktu menjawab (detik)</label>
                      <input
                        id={fieldId("time")}
                        type="number"
                        inputMode="numeric"
                        min={TIME_LIMIT_MIN_SEC}
                        max={TIME_LIMIT_MAX_SEC}
                        step={1}
                        value={Number.isNaN(question.timeLimitSec) ? "" : question.timeLimitSec}
                        onChange={(event) => updateQuestion(index, { timeLimitSec: event.target.valueAsNumber })}
                        {...invalidProps(fieldId("time-error"), errors[`${path}.timeLimitSec`])}
                      />
                      <FieldError id={fieldId("time-error")} message={errors[`${path}.timeLimitSec`]} />
                    </div>

                    <div className="field">
                      <label htmlFor={fieldId("explanation")}>Penjelasan, tidak wajib</label>
                      <textarea
                        id={fieldId("explanation")}
                        rows={2}
                        value={question.explanation}
                        onChange={(event) => updateQuestion(index, { explanation: event.target.value })}
                        {...invalidProps(fieldId("explanation-error"), errors[`${path}.explanation`])}
                      />
                      <FieldError id={fieldId("explanation-error")} message={errors[`${path}.explanation`]} />
                    </div>

                    <div className="question-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={index === 0}
                        onClick={() => changeQuestionList(moveQuestion(draft.questions, index, -1))}
                      >
                        Naik
                      </button>
                      <button
                        type="button"
                        className="button"
                        disabled={index === draft.questions.length - 1}
                        onClick={() => changeQuestionList(moveQuestion(draft.questions, index, 1))}
                      >
                        Turun
                      </button>
                      <button
                        type="button"
                        className="button button-teks button-teks-bahaya"
                        onClick={() => changeQuestionList(draft.questions.filter((_, i) => i !== index))}
                      >
                        Hapus soal
                      </button>
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ol>

          <FieldError id="questions-error" message={errors.questions} />
          <button
            type="button"
            className="button"
            disabled={draft.questions.length >= MAX_QUESTIONS_PER_QUIZ}
            onClick={() => changeQuestionList([...draft.questions, newQuestionDraft()])}
          >
            Tambah soal
          </button>
        </main>
      </div>
    </div>
  );
}
