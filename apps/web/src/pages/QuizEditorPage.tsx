import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MAX_OPTIONS, MAX_QUESTIONS_PER_QUIZ, MIN_OPTIONS, TIME_LIMIT_MAX_SEC, TIME_LIMIT_MIN_SEC } from "@sorak/shared";
import { AnswerTile, answerLetter } from "../AnswerOption.tsx";
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

/** Centang yang digambar sekali (stroke-dashoffset), dipakai di pil "Jawaban benar" dan "Tersimpan". */
function CheckMark() {
  return (
    <svg className="check-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 12.5l5 5L20 6.5" pathLength={1} />
    </svg>
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
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Soal yang sedang diedit (fokus terakhir), ditandai kapur di daftar soal kiri.
  const [activeKey, setActiveKey] = useState<string | null>(null);

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

  // "Tersimpan" di kepala hanya benar sampai guru mengubah sesuatu lagi.
  function clearSavedNotice() {
    setNotice((current) => (current?.kind === "success" ? null : current));
  }

  function editDraft(patch: Partial<QuizDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    clearSavedNotice();
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    clearSavedNotice();
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

  async function handleSave() {
    setNotice(null);
    const validation = validateDraft(draft);
    if (!validation.ok) {
      setErrors(validation.fields);
      setNotice({ kind: "error", text: "Periksa kotak yang ditandai merah." });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const saved = id ? await updateQuiz(id, validation.input) : await createQuiz(validation.input);
      setDraft(draftFromQuiz(saved));
      setNotice({ kind: "success", text: "Tersimpan" });
      if (!id) navigate(`/quizzes/${saved.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(error.fields);
      if (error instanceof ApiRequestError && error.code === "UNAUTHENTICATED") {
        setNotice({ kind: "error", text: "Sesi berakhir. Buka halaman masuk di tab baru, lalu simpan ulang." });
        return;
      }
      setNotice({ kind: "error", text: describeError(error) });
    } finally {
      setSaving(false);
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
          {notice && (
            <p className={notice.kind === "success" ? "notice" : "alert"} role={notice.kind === "success" ? "status" : "alert"}>
              {notice.kind === "success" && <CheckMark />}
              {notice.text}
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
