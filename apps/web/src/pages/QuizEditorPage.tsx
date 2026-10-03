import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MAX_OPTIONS, MAX_QUESTIONS_PER_QUIZ, MIN_OPTIONS, TIME_LIMIT_MAX_SEC, TIME_LIMIT_MIN_SEC } from "@sorak/shared";
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
  const { id } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>(id ? { kind: "loading" } : { kind: "ready" });
  const [draft, setDraft] = useState<QuizDraft>(emptyQuizDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

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

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    }));
  }

  // Error ditandai per nomor soal; begitu urutan soal berubah, nomornya tidak lagi menunjuk soal yang sama.
  function changeQuestionList(questions: QuestionDraft[]) {
    setDraft((current) => ({ ...current, questions }));
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
      setNotice({ kind: "success", text: "Kuis tersimpan." });
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
    <main className="page">
      <header className="page-header">
        <h1>{id ? "Ubah kuis" : "Kuis baru"}</h1>
        <Link to="/quizzes">Kembali</Link>
      </header>

      <div className="field">
        <label htmlFor="quiz-title">Judul</label>
        <input
          id="quiz-title"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          {...invalidProps("quiz-title-error", errors.title)}
        />
        <FieldError id="quiz-title-error" message={errors.title} />
      </div>

      <div className="field">
        <label htmlFor="quiz-description">Deskripsi (opsional)</label>
        <textarea
          id="quiz-description"
          rows={2}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          {...invalidProps("quiz-description-error", errors.description)}
        />
        <FieldError id="quiz-description-error" message={errors.description} />
      </div>

      <ol className="question-list">
        {draft.questions.map((question, index) => {
          const path = `questions.${index}`;
          const fieldId = (name: string) => `${question.key}-${name}`;
          return (
            <li key={question.key} className="question-card">
              <fieldset>
                <legend>Soal {index + 1}</legend>

                <div className="field">
                  <label htmlFor={fieldId("prompt")}>Pertanyaan</label>
                  <textarea
                    id={fieldId("prompt")}
                    rows={2}
                    value={question.prompt}
                    onChange={(event) => updateQuestion(index, { prompt: event.target.value })}
                    {...invalidProps(fieldId("prompt-error"), errors[`${path}.prompt`])}
                  />
                  <FieldError id={fieldId("prompt-error")} message={errors[`${path}.prompt`]} />
                </div>

                <fieldset className="options">
                  <legend>Opsi jawaban (pilih yang benar)</legend>
                  {question.options.map((option, optionIndex) => {
                    const optionPath = `${path}.options.${optionIndex}`;
                    return (
                      <div key={optionIndex} className="option-row">
                        <input
                          type="radio"
                          id={fieldId(`correct-${optionIndex}`)}
                          name={fieldId("correct")}
                          checked={question.correctIndex === optionIndex}
                          onChange={() => updateQuestion(index, { correctIndex: optionIndex })}
                        />
                        <label htmlFor={fieldId(`correct-${optionIndex}`)} className="visually-hidden">
                          Jadikan opsi {optionIndex + 1} jawaban benar
                        </label>
                        <label htmlFor={fieldId(`option-${optionIndex}`)} className="visually-hidden">
                          Opsi {optionIndex + 1}
                        </label>
                        <input
                          id={fieldId(`option-${optionIndex}`)}
                          placeholder={`Opsi ${optionIndex + 1}`}
                          value={option}
                          onChange={(event) =>
                            updateQuestion(index, {
                              options: question.options.map((text, i) => (i === optionIndex ? event.target.value : text)),
                            })
                          }
                          {...invalidProps(fieldId(`option-${optionIndex}-error`), errors[optionPath])}
                        />
                        <button
                          type="button"
                          className="button"
                          disabled={question.options.length <= MIN_OPTIONS}
                          onClick={() => {
                            updateQuestion(index, removeOption(question, optionIndex));
                            setErrors({});
                          }}
                        >
                          Hapus opsi
                        </button>
                        <FieldError id={fieldId(`option-${optionIndex}-error`)} message={errors[optionPath]} />
                      </div>
                    );
                  })}
                  <FieldError id={fieldId("options-error")} message={errors[`${path}.options`] ?? errors[`${path}.correctIndex`]} />
                  <button
                    type="button"
                    className="button"
                    disabled={question.options.length >= MAX_OPTIONS}
                    onClick={() => updateQuestion(index, { options: [...question.options, ""] })}
                  >
                    Tambah opsi
                  </button>
                </fieldset>

                <div className="field">
                  <label htmlFor={fieldId("time")}>Batas waktu (detik)</label>
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
                  <label htmlFor={fieldId("explanation")}>Penjelasan setelah jawaban dibuka (opsional)</label>
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
                    className="button button-danger"
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

      <div className="save-bar">
        {notice && (
          <p className={notice.kind === "success" ? "notice" : "alert"} role={notice.kind === "success" ? "status" : "alert"}>
            {notice.text}
          </p>
        )}
        <button type="button" className="button button-primary" disabled={saving} onClick={handleSave}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </main>
  );
}
