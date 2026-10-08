import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { QuizSummary } from "@sorak/shared";
import { createRoom, deleteQuiz, describeError, listQuizzes, logout } from "../api.ts";
import { useHost } from "../RequireHost.tsx";

type ListState = { kind: "loading" } | { kind: "ready"; quizzes: QuizSummary[] } | { kind: "error"; message: string };

const updatedAtFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

export function QuizListPage() {
  const host = useHost();
  const navigate = useNavigate();
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingQuizId, setStartingQuizId] = useState<string | null>(null);

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

  async function handlePlay(quiz: QuizSummary) {
    setActionError(null);
    setStartingQuizId(quiz.id);
    try {
      const { pin } = await createRoom(quiz.id);
      navigate(`/host/${pin}`);
    } catch (error) {
      setActionError(describeError(error));
      setStartingQuizId(null);
    }
  }

  async function handleLogout() {
    setActionError(null);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Kuis saya</h1>
          <p className="muted">Masuk sebagai {host.displayName}</p>
        </div>
        <button type="button" className="button" onClick={handleLogout}>
          Keluar
        </button>
      </header>

      <Link className="button button-primary" to="/quizzes/new">
        Kuis baru
      </Link>

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
        <p className="empty">Belum ada kuis. Buat kuis pertamamu dengan tombol "Kuis baru".</p>
      )}
      {state.kind === "ready" && state.quizzes.length > 0 && (
        <ul className="quiz-list">
          {state.quizzes.map((quiz) => (
            <li key={quiz.id} className="quiz-item">
              <div>
                <Link className="quiz-title" to={`/quizzes/${quiz.id}`}>
                  {quiz.title}
                </Link>
                <p className="muted">
                  {quiz.questionCount} soal · diubah {updatedAtFormat.format(quiz.updatedAt)}
                </p>
              </div>
              <div className="quiz-actions">
                {/* Room butuh minimal satu soal; server juga menolaknya dengan 409. */}
                <button
                  type="button"
                  className="button button-primary"
                  disabled={quiz.questionCount === 0 || startingQuizId !== null}
                  onClick={() => handlePlay(quiz)}
                >
                  {startingQuizId === quiz.id ? "Membuka…" : "Mainkan"}
                </button>
                <button type="button" className="button button-danger" onClick={() => handleDelete(quiz)}>
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
