import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Pin } from "@sorak/shared";
import { AnswerRow, AnswerTile, answerLetter } from "../AnswerOption.tsx";
import type { HostBase } from "../host-screen.ts";
import { createHostSession, type HostSession, type HostView } from "../host-session.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import { useRemainingMs } from "../useRemainingMs.ts";
import { useTheme } from "../theme.ts";

type QuestionView = Extract<HostView, { kind: "question" }>;
type RevealView = Extract<HostView, { kind: "reveal" }>;
type EndedView = Extract<HostView, { kind: "ended" }>;

/** Layar proyektor: dibaca dari belakang kelas, jadi PIN, soal, dan hitung mundur sebesar mungkin. */
export function HostPage() {
  useTheme("kertas");
  const params = useParams();
  const parsed = Pin.safeParse(params.pin);
  const pin = parsed.success ? parsed.data : null;
  const navigate = useNavigate();
  const [view, setView] = useState<HostView>({ kind: "connecting" });
  const session = useRef<HostSession | null>(null);

  useEffect(() => {
    if (!pin) return;
    const current = createHostSession(pin, setView);
    session.current = current;
    current.connect();
    return () => {
      current.stop();
      session.current = null;
    };
  }, [pin]);

  function handleCancel() {
    if (!window.confirm("Batalkan room ini? Semua siswa akan keluar.")) return;
    session.current?.end();
    navigate("/quizzes");
  }

  function handleEndGame() {
    if (!window.confirm("Akhiri game sekarang? Soal yang sedang berjalan tidak dinilai.")) return;
    session.current?.end();
  }

  if (!pin) return <HostClosed message="PIN tidak valid." />;

  switch (view.kind) {
    case "connecting":
    case "syncing":
      return (
        <p className="page-status" role="status">
          Membuka room…
        </p>
      );
    case "closed":
      return <HostClosed message={view.message} onRetry={view.canRetry ? () => session.current?.connect() : undefined} />;
    case "lobby":
      return <Lobby pin={pin} base={view.base} onStart={() => session.current?.startGame()} onCancel={handleCancel} />;
    case "question":
      return <QuestionScreen view={view} onEndGame={handleEndGame} />;
    case "grace":
      return (
        <main className="host-screen">
          <Notice base={view.base} />
          <p className="host-progress">
            Soal {view.question.q + 1}/{view.question.total}
          </p>
          <h1 className="host-prompt">Menghitung jawaban…</h1>
          <p className="host-count">
            {view.answered}/{view.total} sudah menjawab
          </p>
          <EndGameButton onEndGame={handleEndGame} />
        </main>
      );
    case "reveal":
      return <RevealScreen view={view} onNext={() => session.current?.next()} onEndGame={handleEndGame} />;
    case "ended":
      return <Podium view={view} onDone={() => navigate("/quizzes")} />;
  }
}

function Notice({ base }: { base: HostBase }) {
  if (!base.notice) return null;
  return (
    <p className="alert" role="alert">
      {base.notice}
    </p>
  );
}

function EndGameButton({ onEndGame }: { onEndGame: () => void }) {
  return (
    <div className="host-actions">
      <button type="button" className="button button-danger button-large" onClick={onEndGame}>
        Akhiri game
      </button>
    </div>
  );
}

function Lobby({ pin, base, onStart, onCancel }: { pin: Pin; base: HostBase; onStart: () => void; onCancel: () => void }) {
  const players = base.players;
  return (
    <main className="host-screen">
      <p className="host-join-hint">
        Buka <strong>{location.host}</strong> lalu masukkan PIN
      </p>
      <p className="host-pin">
        {pin.slice(0, 3)} {pin.slice(3)}
      </p>
      <p className="host-count" role="status" aria-live="polite">
        {players.length} pemain · Mode {SCORING_MODES[base.room.scoringMode].name}
      </p>
      <Notice base={base} />
      {players.length === 0 ? (
        <p className="empty">Menunggu siswa masuk…</p>
      ) : (
        <ul className="roster">
          {players.map((player) => (
            <li key={player.playerId}>{player.nickname}</li>
          ))}
        </ul>
      )}
      <div className="host-actions">
        <button type="button" className="button button-primary button-large" disabled={players.length === 0} onClick={onStart}>
          Mulai
        </button>
        <button type="button" className="button button-danger button-large" onClick={onCancel}>
          Batalkan
        </button>
      </div>
    </main>
  );
}

function QuestionScreen({ view, onEndGame }: { view: QuestionView; onEndGame: () => void }) {
  const { question } = view;
  const remaining = useRemainingMs(view.startedAt, view.durationMs);
  return (
    <main className="host-screen">
      <Notice base={view.base} />
      <div className="host-question-meta">
        <span className="host-progress">
          Soal {question.q + 1}/{question.total}
        </span>
        <span className="host-countdown" role="timer" aria-label={`Sisa waktu ${Math.ceil(remaining / 1000)} detik`}>
          {Math.ceil(remaining / 1000)}
        </span>
      </div>
      <h1 className="host-prompt">{question.prompt}</h1>
      <ul className="answers answers-host">
        {question.options.map((text, index) => (
          <AnswerRow key={index} index={index} text={text} />
        ))}
      </ul>
      <p className="host-count" role="status" aria-live="polite">
        {view.answered}/{view.total} sudah menjawab
      </p>
      <EndGameButton onEndGame={onEndGame} />
    </main>
  );
}

function RevealScreen({ view, onNext, onEndGame }: { view: RevealView; onNext: () => void; onEndGame: () => void }) {
  const { reveal, question } = view;
  const most = Math.max(1, ...reveal.counts);
  return (
    <main className="host-screen">
      <p className="host-progress">
        Soal {reveal.q + 1}
        {question ? `/${question.total}` : ""} · {reveal.answered}/{reveal.total} menjawab
      </p>
      {question && <h1 className="host-prompt">{question.prompt}</h1>}
      <ul className="answers answers-host">
        {(question?.options ?? reveal.counts.map(() => "")).map((text, index) => (
          <AnswerRow
            key={index}
            index={index}
            text={text}
            correct={index === reveal.correctIndex}
            dimmed={index !== reveal.correctIndex}
          />
        ))}
      </ul>
      <ul className="distribution" aria-label="Sebaran jawaban">
        {reveal.counts.map((count, index) => (
          <li key={index} aria-label={`Pilihan ${answerLetter(index)}: ${count} jawaban`}>
            <AnswerTile index={index} />
            <span className="distribution-track">
              <span className={`distribution-bar answer-${index}`} style={{ width: `${(count / most) * 100}%` }} />
            </span>
            <span className="distribution-count">{count}</span>
          </li>
        ))}
      </ul>
      <ol className="leaderboard">
        {reveal.leaderboard.map((entry) => (
          <li key={entry.playerId}>
            <span className="leaderboard-rank">{entry.rank}</span>
            <span className="leaderboard-name">{entry.nickname}</span>
            <span className="leaderboard-score">{entry.score}</span>
            <span className="leaderboard-delta">
              {entry.delta >= 0 ? "+" : ""}
              {entry.delta}
            </span>
          </li>
        ))}
      </ol>
      <div className="host-actions">
        <button type="button" className="button button-primary button-large" onClick={onNext}>
          {reveal.isLastQuestion ? "Lihat podium" : "Lanjut"}
        </button>
        <button type="button" className="button button-danger button-large" onClick={onEndGame}>
          Akhiri game
        </button>
      </div>
    </main>
  );
}

function Podium({ view, onDone }: { view: EndedView; onDone: () => void }) {
  const { podium } = view;
  return (
    <main className="host-screen">
      <h1 className="host-prompt">Podium</h1>
      {podium.top.length === 0 ? (
        <p className="empty">Belum ada skor.</p>
      ) : (
        <ol className="podium">
          {podium.top.map((entry) => (
            <li key={entry.playerId}>
              <span className="leaderboard-rank">{entry.rank}</span>
              <span className="leaderboard-name">{entry.nickname}</span>
              <span className="leaderboard-score">{entry.score} poin</span>
            </li>
          ))}
        </ol>
      )}
      <p className="host-count">{podium.playerCount} pemain</p>
      <div className="host-actions">
        <button type="button" className="button button-primary button-large" onClick={onDone}>
          Selesai
        </button>
      </div>
    </main>
  );
}

function HostClosed({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }) {
  return (
    <main className="page page-narrow">
      <p className="alert" role="alert">
        {message}
      </p>
      {onRetry && (
        <button type="button" className="button button-primary" onClick={onRetry}>
          Sambung lagi
        </button>
      )}
      <Link className="button" to="/quizzes">
        Kembali ke Kuis saya
      </Link>
    </main>
  );
}
