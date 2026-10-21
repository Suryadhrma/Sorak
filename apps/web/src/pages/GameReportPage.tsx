import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { REPORT_RETRY_ATTEMPTS, REPORT_RETRY_DELAY_MS, type GameDetail, type GameQuestionResult } from "@sorak/shared";
import { AnswerTile, answerLetter } from "../AnswerOption.tsx";
import { ApiRequestError, describeError, getGame } from "../api.ts";
import { Logo } from "../Logo.tsx";
import { PodiumNavigationState, correctPercent, needsReview, reportRetryStep, topDistractor } from "../report.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import { useTheme } from "../theme.ts";

type ReportState =
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "ready"; game: GameDetail }
  /** canRetry: laporan mungkin masih disimpan (dibuka dari podium), atau gagal karena jaringan. */
  | { kind: "error"; message: string; canRetry: boolean };

const endedAtFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/** Laporan satu game: skor pemain dan persen benar per soal. */
export function GameReportPage() {
  useTheme("kertas");
  const { id = "" } = useParams();
  const location = useLocation();
  const fromPodium = PodiumNavigationState.safeParse(location.state);
  const endedAt = fromPodium.success ? fromPodium.data.gameEndedAt : null;
  const [state, setState] = useState<ReportState>({ kind: "loading" });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(
    (retriesDone: number) => {
      getGame(id)
        .then((game) => setState({ kind: "ready", game }))
        .catch((error: unknown) => {
          if (!(error instanceof ApiRequestError && error.status === 404)) {
            setState({ kind: "error", message: describeError(error), canRetry: true });
            return;
          }
          const step = reportRetryStep({ msSinceGameEnded: endedAt === null ? null : performance.now() - endedAt, retriesDone });
          if (step === "retry") {
            // Consumer Queue biasanya butuh beberapa detik setelah podium.
            setState({ kind: "saving" });
            retryTimer.current = setTimeout(() => load(retriesDone + 1), REPORT_RETRY_DELAY_MS);
            return;
          }
          if (step === "give_up") {
            setState({ kind: "error", message: "Laporan belum tersedia. Hasil game masih disimpan, coba lagi sebentar lagi.", canRetry: true });
            return;
          }
          setState({ kind: "error", message: "Laporan tidak ditemukan.", canRetry: false });
        });
    },
    [id, endedAt],
  );

  useEffect(() => {
    load(0);
    return () => clearTimeout(retryTimer.current);
  }, [load]);

  function retry() {
    setState({ kind: "loading" });
    // Tombol Coba lagi: satu percobaan, tanpa putaran otomatis lagi.
    load(REPORT_RETRY_ATTEMPTS);
  }

  return (
    <main className="page buku">
      <header className="page-header">
        <div>
          <Logo />
          <h1>Rapor kelas</h1>
        </div>
        <Link className="button" to="/games">
          Riwayat
        </Link>
      </header>

      {state.kind === "loading" && (
        <p className="page-status" role="status">
          Memuat laporan…
        </p>
      )}
      {state.kind === "saving" && (
        <p className="page-status" role="status">
          Laporan sedang disimpan…
        </p>
      )}
      {state.kind === "error" && (
        <>
          <p className="alert" role="alert">
            {state.message}
          </p>
          {state.canRetry && (
            <button type="button" className="button" onClick={retry}>
              Coba lagi
            </button>
          )}
        </>
      )}
      {state.kind === "ready" && <Report game={state.game} />}
    </main>
  );
}

function Report({ game }: { game: GameDetail }) {
  return (
    <>
      <section className="report-head">
        <h2>{game.quizTitle}</h2>
        <p className="muted">
          {endedAtFormat.format(game.endedAt)} · Mode {SCORING_MODES[game.scoringMode].name} · {game.playerCount} pemain
        </p>
      </section>

      <section aria-labelledby="report-players">
        <h2 id="report-players">Skor pemain</h2>
        {game.players.length === 0 ? (
          <p className="empty">Tidak ada pemain yang tersisa di akhir game.</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Peringkat</th>
                <th scope="col">Nama</th>
                <th scope="col">Skor</th>
                <th scope="col">Benar</th>
              </tr>
            </thead>
            <tbody>
              {/* Nickname unik dalam satu game (dijaga GameRoom saat join). */}
              {game.players.map((player) => (
                <tr key={player.nickname}>
                  <td>{player.finalRank}</td>
                  <td>{player.nickname}</td>
                  <td>{player.finalScore}</td>
                  <td>
                    benar {player.correctCount} dari {game.questionCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="report-questions">
        <h2 id="report-questions">Per soal</h2>
        <ol className="report-questions">
          {game.questions.map((question) => (
            <QuestionReport key={question.position} question={question} />
          ))}
        </ol>
      </section>
    </>
  );
}

function QuestionReport({ question }: { question: GameQuestionResult }) {
  const percent = correctPercent(question);
  const distractor = topDistractor(question);
  const most = Math.max(1, ...question.answerCounts);
  return (
    <li className="report-question">
      <p className="report-prompt">
        <span className="muted">Soal {question.position + 1}.</span> {question.prompt}
      </p>
      <p className="report-percent">
        {percent === null ? "Tidak ada yang menjawab" : `${percent}% benar`}
        {needsReview(question) && <span className="review-flag"> · Perlu dibahas ulang</span>}
      </p>
      <ul className="distribution report-distribution" aria-label="Sebaran jawaban">
        {question.options.map((text, index) => {
          const count = question.answerCounts[index] ?? 0;
          const correct = index === question.correctIndex;
          return (
            <li
              key={index}
              className={correct ? "distribution-correct" : undefined}
              aria-label={`Pilihan ${answerLetter(index)}: ${text}, ${count} jawaban${correct ? ", jawaban benar" : ""}`}
            >
              <AnswerTile index={index} />
              <span className="report-option">
                <span>
                  {text}
                  {correct && <span className="correct-label"> benar</span>}
                </span>
                <span className="distribution-track">
                  <span className={`distribution-bar answer-${index}`} style={{ width: `${(count / most) * 100}%` }} />
                </span>
              </span>
              <span className="distribution-count">{count}</span>
            </li>
          );
        })}
      </ul>
      {distractor && (
        <p className="muted">
          Pengecoh terpopuler: {answerLetter(distractor.index)} dipilih {distractor.count} siswa
        </p>
      )}
    </li>
  );
}
