import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CreateRoomInput, type QuizSummary } from "@sorak/shared";
import { createRoom, deleteQuiz, describeError, listQuizzes } from "../api.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import { TeacherHeader } from "../TeacherHeader.tsx";
import { useTheme } from "../theme.ts";

/** Mode yang diterima server saat membuat room; satu sumber dengan skema REST. */
const PLAYABLE_MODES = CreateRoomInput.shape.scoringMode.options;

type ListState = { kind: "loading" } | { kind: "ready"; quizzes: QuizSummary[] } | { kind: "error"; message: string };

const updatedAtFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long" });

/** Guru-2: daftar kuis di kertas bergaris. Mainkan membuka dialog pilih mode (Guru-4). */
export function QuizListPage() {
  useTheme("kertas");
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<QuizSummary | null>(null);

  useEffect(() => {
    let active = true;
    listQuizzes()
      .then((quizzes) => {
        if (active) setState({ kind: "ready", quizzes });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", message: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleDelete(quiz: QuizSummary) {
    if (!window.confirm(`Hapus kuis "${quiz.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    setActionError(null);
    try {
      await deleteQuiz(quiz.id);
      setState((current) =>
        current.kind === "ready" ? { kind: "ready", quizzes: current.quizzes.filter((q) => q.id !== quiz.id) } : current,
      );
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  const needle = query.trim().toLocaleLowerCase("id");
  const shown =
    state.kind === "ready" ? state.quizzes.filter((quiz) => quiz.title.toLocaleLowerCase("id").includes(needle)) : [];

  return (
    <div className="buku">
      <TeacherHeader />
      <main className="buku-isi">
        <div className="buku-judul">
          <div>
            <h1>Kuis saya</h1>
            {state.kind === "ready" && state.quizzes.length > 0 && (
              <p className="buku-lead">{state.quizzes.length} kuis. Kuis yang sudah punya soal bisa langsung dimainkan.</p>
            )}
          </div>
          <Link className="button button-primary" to="/quizzes/new">
            Buat kuis baru
          </Link>
        </div>

        {actionError && (
          <p className="alert" role="alert">
            {actionError}
          </p>
        )}

        {state.kind === "loading" && <p role="status">Memuat daftar kuis…</p>}
        {state.kind === "error" && (
          <p className="alert" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && state.quizzes.length === 0 && (
          <p className="empty">Belum ada kuis. Buat kuis pertamamu dengan tombol "Buat kuis baru".</p>
        )}
        {state.kind === "ready" && state.quizzes.length > 0 && (
          <>
            <div className="buku-cari">
              <label htmlFor="quiz-search" className="visually-hidden">
                Cari judul kuis
              </label>
              <input
                id="quiz-search"
                type="search"
                placeholder="Cari judul kuis"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {shown.length === 0 && <p className="empty">Tidak ada kuis dengan judul itu.</p>}
            <ul className="buku-daftar">
              {shown.map((quiz) => (
                <QuizRow key={quiz.id} quiz={quiz} onPlay={() => setPlaying(quiz)} onDelete={() => handleDelete(quiz)} />
              ))}
            </ul>
          </>
        )}
      </main>
      {playing && <PlayDialog quiz={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

function QuizRow({ quiz, onPlay, onDelete }: { quiz: QuizSummary; onPlay: () => void; onDelete: () => void }) {
  // Room butuh minimal satu soal; server juga menolaknya dengan 409. Soal yang tersimpan selalu lengkap
  // (divalidasi saat simpan), jadi satu-satunya kuis yang belum bisa dimainkan adalah kuis tanpa soal.
  const playable = quiz.questionCount > 0;
  return (
    <li className="buku-baris">
      <div className="buku-baris-isi">
        <p className="buku-baris-judul">{quiz.title}</p>
        <p className="muted">
          {playable ? `${quiz.questionCount} soal` : "Draf"}, diubah {updatedAtFormat.format(quiz.updatedAt)}
        </p>
        {!playable && <p className="buku-peringatan">Belum bisa dimainkan: kuis ini belum punya soal.</p>}
      </div>
      <div className="quiz-actions">
        {playable ? (
          <button type="button" className="button button-tinta" onClick={onPlay}>
            Mainkan
          </button>
        ) : (
          <Link className="button" to={`/quizzes/${quiz.id}`}>
            Lengkapi soal
          </Link>
        )}
        <Link className="button" to={`/quizzes/${quiz.id}`} aria-label={`Ubah ${quiz.title}`}>
          Ubah
        </Link>
        <button type="button" className="button button-teks button-teks-bahaya" onClick={onDelete} aria-label={`Hapus ${quiz.title}`}>
          Hapus
        </button>
      </div>
    </li>
  );
}

/** Guru-4: pilih mode skor lalu buka room. <dialog> bawaan browser: fokus terkunci di dialog, Esc menutupnya. */
function PlayDialog({ quiz, onClose }: { quiz: QuizSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [mode, setMode] = useState<CreateRoomInput["scoringMode"]>("classic");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const { pin } = await createRoom({ quizId: quiz.id, scoringMode: mode });
      navigate(`/host/${pin}`);
    } catch (caught) {
      setError(describeError(caught));
      setStarting(false);
    }
  }

  return (
    <dialog ref={dialog} className="mode-dialog" aria-labelledby={titleId} onCancel={onClose}>
      <p className="muted-strong">Mainkan</p>
      <h2 id={titleId} className="mode-dialog-title">
        {quiz.title}
      </h2>
      <p className="buku-lead">{quiz.questionCount} soal. Pilih cara menghitung poin.</p>
      <fieldset className="mode-cards">
        <legend className="visually-hidden">Cara menghitung poin</legend>
        {PLAYABLE_MODES.map((option) => (
          <label key={option} className="mode-card">
            <input
              type="radio"
              name="scoring-mode"
              value={option}
              checked={mode === option}
              disabled={starting}
              onChange={() => setMode(option)}
            />
            <span className="mode-card-name">{SCORING_MODES[option].name}</span>
            <span className="mode-card-text">{SCORING_MODES[option].description}</span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="mode-dialog-actions">
        <button type="button" className="button button-teks" onClick={onClose} disabled={starting}>
          Batal
        </button>
        <button type="button" className="button button-tinta" onClick={handleStart} disabled={starting}>
          {starting ? "Membuka ruang…" : "Buka ruang dan tampilkan PIN"}
        </button>
      </div>
    </dialog>
  );
}
