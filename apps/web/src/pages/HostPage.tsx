import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Pin, type RosterEntry } from "@sorak/shared";
import { AnswerRow, AnswerTile, answerLetter } from "../AnswerOption.tsx";
import { disconnectedCount, type HostBase } from "../host-screen.ts";
import { createHostSession, type HostSession, type HostView } from "../host-session.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import type { ConnectionStatus } from "../socket.ts";
import { useRemainingMs } from "../useRemainingMs.ts";
import { useTheme } from "../theme.ts";

type QuestionView = Extract<HostView, { kind: "question" }>;
type RevealView = Extract<HostView, { kind: "reveal" }>;
type EndedView = Extract<HostView, { kind: "ended" }>;
type KickTarget = { playerId: string; nickname: string };

/** Layar proyektor: dibaca dari belakang kelas, jadi PIN, soal, dan hitung mundur sebesar mungkin. */
export function HostPage() {
  useTheme("kertas");
  const params = useParams();
  const parsed = Pin.safeParse(params.pin);
  const pin = parsed.success ? parsed.data : null;
  const navigate = useNavigate();
  const [view, setView] = useState<HostView>({ kind: "connecting" });
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting", attempt: 0 });
  const [kickTarget, setKickTarget] = useState<KickTarget | null>(null);
  const session = useRef<HostSession | null>(null);

  useEffect(() => {
    if (!pin) return;
    const current = createHostSession(pin, setView, setStatus);
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

  function handleKick(target: KickTarget) {
    session.current?.kick(target.playerId);
    setKickTarget(null);
  }

  if (!pin) return <HostClosed message="PIN tidak valid." />;
  if (view.kind === "closed") return <HostClosed message={view.message} />;

  // Strip kecil di tepi atas, tidak menutupi soal di proyektor.
  const offline = status.kind === "waiting" || (status.kind === "connecting" && status.attempt > 0);
  return (
    <>
      {offline && (
        <p className="reconnect-strip" role="status">
          Menyambung ulang…
        </p>
      )}
      <HostStage view={view} pin={pin} session={session.current} onCancel={handleCancel} onEndGame={handleEndGame} onKick={setKickTarget} navigateHome={() => navigate("/quizzes")} />
      {kickTarget && <KickDialog target={kickTarget} onConfirm={() => handleKick(kickTarget)} onCancel={() => setKickTarget(null)} />}
    </>
  );
}

function HostStage(props: {
  view: Exclude<HostView, { kind: "closed" }>;
  pin: Pin;
  session: HostSession | null;
  onCancel: () => void;
  onEndGame: () => void;
  onKick: (target: KickTarget) => void;
  navigateHome: () => void;
}) {
  const { view, session } = props;
  switch (view.kind) {
    case "connecting":
    case "syncing":
      return (
        <p className="page-status" role="status">
          Membuka room…
        </p>
      );
    case "lobby":
      return <Lobby pin={props.pin} base={view.base} onStart={() => session?.startGame()} onCancel={props.onCancel} onKick={props.onKick} />;
    case "question":
      return <QuestionScreen view={view} onEndGame={props.onEndGame} />;
    case "grace":
      return (
        <main className="host-screen">
          <Notice base={view.base} />
          <p className="host-progress">
            Soal {view.question.q + 1}/{view.question.total}
          </p>
          <h1 className="host-prompt">Menghitung jawaban…</h1>
          <AnsweredCount answered={view.answered} total={view.total} players={view.base.players} />
          <EndGameButton onEndGame={props.onEndGame} />
        </main>
      );
    case "reveal":
      return <RevealScreen view={view} onNext={() => session?.next()} onEndGame={props.onEndGame} onKick={props.onKick} />;
    case "ended":
      return <Podium view={view} onDone={props.navigateHome} />;
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

/** "18 dari 27 sudah menjawab · 2 terputus": jumlah terputus hanya tampil kalau lebih dari 0. */
function AnsweredCount({ answered, total, players }: { answered: number; total: number; players: readonly RosterEntry[] }) {
  const offline = disconnectedCount(players);
  return (
    <p className="host-count" role="status" aria-live="polite">
      {answered} dari {total} sudah menjawab
      {offline > 0 && <span className="host-offline"> · {offline} terputus</span>}
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

function Lobby(props: { pin: Pin; base: HostBase; onStart: () => void; onCancel: () => void; onKick: (target: KickTarget) => void }) {
  const { pin, base } = props;
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
            <li key={player.playerId}>
              <button
                type="button"
                className="roster-name"
                aria-label={`${player.nickname}. Tekan untuk mengeluarkan.`}
                onClick={() => props.onKick({ playerId: player.playerId, nickname: player.nickname })}
              >
                {player.nickname}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="host-actions">
        <button type="button" className="button button-primary button-large" disabled={players.length === 0} onClick={props.onStart}>
          Mulai
        </button>
        <button type="button" className="button button-danger button-large" onClick={props.onCancel}>
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
      <AnsweredCount answered={view.answered} total={view.total} players={view.base.players} />
      <EndGameButton onEndGame={onEndGame} />
    </main>
  );
}

function RevealScreen(props: { view: RevealView; onNext: () => void; onEndGame: () => void; onKick: (target: KickTarget) => void }) {
  const { reveal, question, base } = props.view;
  const most = Math.max(1, ...reveal.counts);
  const offlineIds = new Set(base.players.filter((player) => !player.connected).map((player) => player.playerId));
  return (
    <main className="host-screen">
      <p className="host-progress">
        Soal {reveal.q + 1}
        {question ? `/${question.total}` : ""} · {reveal.answered}/{reveal.total} menjawab
        {offlineIds.size > 0 && <span className="host-offline"> · {offlineIds.size} terputus</span>}
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
            <button
              type="button"
              className={`leaderboard-row${offlineIds.has(entry.playerId) ? " is-offline" : ""}`}
              aria-label={`Peringkat ${entry.rank}, ${entry.nickname}, ${entry.score} poin${offlineIds.has(entry.playerId) ? ", terputus" : ""}. Tekan untuk mengeluarkan.`}
              onClick={() => props.onKick({ playerId: entry.playerId, nickname: entry.nickname })}
            >
              <span className="leaderboard-rank">{entry.rank}</span>
              <span className="leaderboard-name">{entry.nickname}</span>
              <span className="leaderboard-score">{entry.score}</span>
              <span className="leaderboard-delta">
                {entry.delta >= 0 ? "+" : ""}
                {entry.delta}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="host-actions">
        <button type="button" className="button button-primary button-large" onClick={props.onNext}>
          {reveal.isLastQuestion ? "Lihat podium" : "Lanjut"}
        </button>
        <button type="button" className="button button-danger button-large" onClick={props.onEndGame}>
          Akhiri game
        </button>
      </div>
    </main>
  );
}

/** Konfirmasi kick dengan <dialog> bawaan browser: fokus terkunci di dialog, Esc menutupnya. */
function KickDialog({ target, onConfirm, onCancel }: { target: KickTarget; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="kick-dialog" aria-labelledby="kick-title" onCancel={onCancel}>
      <p id="kick-title" className="kick-title">
        Keluarkan {target.nickname} dari ruang ini?
      </p>
      <div className="host-actions">
        <button type="button" className="button button-danger button-large" onClick={onConfirm}>
          Keluarkan
        </button>
        <button type="button" className="button button-large" onClick={onCancel}>
          Batal
        </button>
      </div>
    </dialog>
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

function HostClosed({ message }: { message: string }) {
  return (
    <main className="page page-narrow">
      <p className="alert" role="alert">
        {message}
      </p>
      <Link className="button" to="/quizzes">
        Kembali ke Kuis saya
      </Link>
    </main>
  );
}
