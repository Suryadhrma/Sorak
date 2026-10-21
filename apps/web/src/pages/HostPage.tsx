import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Pin, type LeaderboardEntry, type RosterEntry } from "@sorak/shared";
import { AnswerRow, AnswerTile, answerLetter } from "../AnswerOption.tsx";
import { disconnectedCount, revealStats, type HostBase } from "../host-screen.ts";
import { createHostSession, type HostSession, type HostView } from "../host-session.ts";
import { Logo } from "../Logo.tsx";
import { Countdown } from "../motion/Countdown.tsx";
import { FlapDigits } from "../motion/FlapDigits.tsx";
import { Leaderboard } from "../motion/Leaderboard.tsx";
import { RaiseIn } from "../motion/RaiseIn.tsx";
import { RiseIn } from "../motion/RiseIn.tsx";
import { Tally } from "../motion/Tally.tsx";
import { rankClimb } from "../player-screen.ts";
import type { PodiumNavigationState } from "../report.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import type { ConnectionStatus } from "../socket.ts";
import { useTheme } from "../theme.ts";

type QuestionView = Extract<HostView, { kind: "question" }>;
type RevealView = Extract<HostView, { kind: "reveal" }>;
type EndedView = Extract<HostView, { kind: "ended" }>;
type KickTarget = { playerId: string; nickname: string };

const numberFormat = new Intl.NumberFormat("id-ID");
/** Konfeti turus di podium: jumlah elemen CSS (board Proyektor-5), hanya di layar proyektor. */
const CONFETTI_PIECES = 30;

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
        <main className="projector">
          <Notice base={view.base} />
          <header className="projector-bar">
            <span className="projector-brand">
              <Logo />
              <span>
                Soal {view.question.q + 1} dari {view.question.total}
              </span>
            </span>
          </header>
          <h1 className="host-prompt">Menghitung jawaban…</h1>
          <AnsweredCount answered={view.answered} total={view.total} players={view.base.players} />
          <EndGameButton onEndGame={props.onEndGame} />
        </main>
      );
    case "reveal":
      // Key per soal: langkah "sebaran -> papan skor" mulai lagi dari sebaran setiap reveal baru.
      return <RevealScreen key={view.reveal.q} view={view} onNext={() => session?.next()} onEndGame={props.onEndGame} onKick={props.onKick} />;
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
    <p className="projector-count" role="status" aria-live="polite">
      <strong className="projector-count-number">{answered}</strong> dari {total} sudah menjawab
      {offline > 0 && <span className="host-offline"> · {offline} terputus</span>}
    </p>
  );
}

function EndGameButton({ onEndGame }: { onEndGame: () => void }) {
  return (
    <button type="button" className="link-button projector-end" onClick={onEndGame}>
      Akhiri game
    </button>
  );
}

/** Proyektor-1: panel kapur dengan PIN, panel kertas dengan pemain yang sudah masuk. */
function Lobby(props: { pin: Pin; base: HostBase; onStart: () => void; onCancel: () => void; onKick: (target: KickTarget) => void }) {
  const { pin, base } = props;
  const players = base.players;
  const mode = SCORING_MODES[base.room.scoringMode];
  return (
    <main className="projector-lobby">
      <section className="lobby-join">
        <Logo />
        <div className="hp-stack">
          <p className="lobby-hint">
            Buka <strong>{location.host}</strong> di HP,
            <br />
            lalu masukkan PIN ini
          </p>
          <p className="lobby-pin" aria-label={`PIN ${pin}`}>
            <FlapDigits value={pin.slice(0, 3)} />
            <FlapDigits value={pin.slice(3)} />
          </p>
        </div>
        <p className="lobby-quiz">
          {base.room.quizTitle && (
            <strong className="hp-block">
              {base.room.quizTitle}, {base.room.questionCount} soal
            </strong>
          )}
          Mode {mode.name}: {mode.hint}
        </p>
      </section>
      <section className="lobby-players">
        <p className="lobby-count" role="status" aria-live="polite">
          <span className="lobby-count-number">{players.length}</span>
          <span>
            pemain sudah masuk
            <span className="lobby-tally" aria-hidden="true">
              <Tally count={players.length} label={`${players.length} pemain`} />
            </span>
          </span>
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
        <div className="lobby-actions">
          <button type="button" className="link-button" onClick={props.onCancel}>
            Batalkan room
          </button>
          <button type="button" className="button button-tinta button-large" disabled={players.length === 0} onClick={props.onStart}>
            Mulai kuis
          </button>
        </div>
      </section>
    </main>
  );
}

/** Proyektor-2: soal, hitung mundur, dan kartu pilihan yang berputar masuk. */
function QuestionScreen({ view, onEndGame }: { view: QuestionView; onEndGame: () => void }) {
  const { question } = view;
  return (
    <main className="projector">
      <Notice base={view.base} />
      <header className="projector-bar">
        <span className="projector-brand">
          <Logo />
          <span>
            Soal {question.q + 1} dari {question.total}
          </span>
        </span>
        <Countdown startedAt={view.startedAt} durationMs={view.durationMs} className="countdown-projector" />
      </header>
      <h1 className="host-prompt">{question.prompt}</h1>
      <AnsweredCount answered={view.answered} total={view.total} players={view.base.players} />
      <div className="answers answers-host projector-answers" role="list">
        {question.options.map((text, index) => (
          <RaiseIn key={index} index={index}>
            <AnswerRow index={index} text={text} />
          </RaiseIn>
        ))}
      </div>
      <EndGameButton onEndGame={onEndGame} />
    </main>
  );
}

/** Proyektor-3 (sebaran, kunci dibuka) lalu Proyektor-4 (papan skor): dua langkah di layar guru, tanpa pesan baru. */
function RevealScreen(props: { view: RevealView; onNext: () => void; onEndGame: () => void; onKick: (target: KickTarget) => void }) {
  const [step, setStep] = useState<"distribution" | "scoreboard">("distribution");
  if (step === "distribution") return <DistributionScreen view={props.view} onShowScoreboard={() => setStep("scoreboard")} onEndGame={props.onEndGame} />;
  return <ScoreboardScreen view={props.view} onNext={props.onNext} onEndGame={props.onEndGame} onKick={props.onKick} />;
}

function DistributionScreen(props: { view: RevealView; onShowScoreboard: () => void; onEndGame: () => void }) {
  const { reveal, question } = props.view;
  const most = Math.max(1, ...reveal.counts);
  const correctText = question?.options[reveal.correctIndex];
  const stats = revealStats(reveal, props.view.previous);
  return (
    <main className="projector">
      <header className="projector-bar">
        <span className="projector-brand">
          <Logo />
          <span>
            Soal {reveal.q + 1}
            {question ? ` dari ${question.total}` : ""}, kunci dibuka
          </span>
        </span>
      </header>
      {question && <h1 className="host-prompt projector-prompt-small">{question.prompt}</h1>}
      <div className="reveal-layout">
        <ul className="distribution projector-distribution" aria-label="Sebaran jawaban">
          {reveal.counts.map((count, index) => (
            <li key={index} className={index === reveal.correctIndex ? "distribution-correct" : undefined}>
              <AnswerTile index={index} />
              <span className="report-option">
                <span>{question?.options[index] ?? `Pilihan ${answerLetter(index)}`}</span>
                <span className="distribution-track">
                  <RiseIn axis="x" order={index}>
                    <span className={`distribution-bar answer-${index}`} style={{ width: `${(count / most) * 100}%` }} />
                  </RiseIn>
                </span>
              </span>
              <span className="distribution-count" aria-label={`${count} jawaban`}>
                {count}
              </span>
            </li>
          ))}
        </ul>
        <aside className="reveal-answer">
          <p className="reveal-answer-key">
            {answerLetter(reveal.correctIndex)}
            {correctText ? `, ${correctText}` : ""}
          </p>
          <p>
            {stats.correct} dari {stats.total} siswa menjawab benar
          </p>
        </aside>
      </div>
      <div className="projector-actions">
        <EndGameButton onEndGame={props.onEndGame} />
        <button type="button" className="button button-tinta button-large" onClick={props.onShowScoreboard}>
          Lihat papan skor
        </button>
      </div>
    </main>
  );
}

function ScoreboardScreen(props: { view: RevealView; onNext: () => void; onEndGame: () => void; onKick: (target: KickTarget) => void }) {
  const { reveal, question, base, previous } = props.view;
  const offlineIds = new Set(base.players.filter((player) => !player.connected).map((player) => player.playerId));
  const oldRank = new Map((previous ?? []).map((entry) => [entry.playerId, entry.rank]));
  const stats = revealStats(reveal, previous);

  const row = (entry: LeaderboardEntry) => {
    const offline = offlineIds.has(entry.playerId);
    const climb = rankClimb(oldRank.get(entry.playerId) ?? null, entry.rank);
    return (
      <button
        type="button"
        className={`leaderboard-row${offline ? " is-offline" : ""}`}
        aria-label={`Peringkat ${entry.rank}, ${entry.nickname}, ${entry.score} poin${offline ? ", terputus" : ""}. Tekan untuk mengeluarkan.`}
        onClick={() => props.onKick({ playerId: entry.playerId, nickname: entry.nickname })}
      >
        <span className="leaderboard-rank">{entry.rank}</span>
        <span className="leaderboard-name">
          {entry.nickname}
          {climb !== null && <span className="leaderboard-climb"> naik {climb}</span>}
        </span>
        <span className="leaderboard-score">
          <FlapDigits value={numberFormat.format(entry.score)} />
        </span>
      </button>
    );
  };

  return (
    <main className="projector projector-split">
      <section className="scoreboard-panel">
        <header className="projector-bar">
          <h1 className="scoreboard-title">Papan skor</h1>
          <span>
            setelah soal {reveal.q + 1}
            {question ? ` dari ${question.total}` : ""}
          </span>
        </header>
        <Leaderboard entries={reveal.leaderboard} previous={previous} renderRow={row} />
      </section>
      <aside className="scoreboard-side">
        <Logo />
        <dl className="scoreboard-stats">
          {stats.biggestClimb && (
            <div>
              <dt>Naik paling jauh</dt>
              <dd>
                {stats.biggestClimb.nickname}, dari {stats.biggestClimb.from} ke {stats.biggestClimb.to}
              </dd>
            </div>
          )}
          {stats.topPoints && (
            <div>
              <dt>Poin terbesar soal ini</dt>
              <dd>
                {stats.topPoints.nickname}, +{numberFormat.format(stats.topPoints.points)}
              </dd>
            </div>
          )}
          <div>
            <dt>Soal ini</dt>
            <dd>
              {stats.correct} dari {stats.total} benar
            </dd>
          </div>
          {offlineIds.size > 0 && (
            <div>
              <dt>Terputus</dt>
              <dd>{offlineIds.size} pemain</dd>
            </div>
          )}
        </dl>
        <div className="scoreboard-next">
          <button type="button" className="button button-tinta button-large" onClick={props.onNext}>
            {reveal.isLastQuestion ? "Lihat podium" : "Soal berikutnya"}
          </button>
          <p className="muted">Siswa melihat peringkat masing-masing di HP.</p>
          <EndGameButton onEndGame={props.onEndGame} />
        </div>
      </aside>
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

/** Proyektor-5: balok podium naik bergantian (juara 1 terakhir), konfeti turus, dan tombol rapor kelas. */
function Podium({ view, onDone }: { view: EndedView; onDone: () => void }) {
  const { podium, base } = view;
  const navigate = useNavigate();
  // Laporan baru ada setelah consumer Queue menyimpannya; halaman laporan menunggu kalau dibuka terlalu cepat.
  const onReport = () => {
    const state: PodiumNavigationState = { gameEndedAt: performance.now() };
    navigate(`/games/${podium.gameId}`, { state });
  };
  // Urutan tampil kiri ke kanan: juara 2, juara 1, juara 3. Urutan naik: juara 3 dulu, juara 1 terakhir.
  const [first, second, third] = podium.top;
  const blocks = [
    { entry: second, place: 2, order: 1 },
    { entry: first, place: 1, order: 2 },
    { entry: third, place: 3, order: 0 },
  ];

  return (
    <main className="projector projector-podium">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: CONFETTI_PIECES }, (_, index) => (
          <span
            key={index}
            className={`confetti-piece confetti-${index % 5}`}
            style={{ left: `${(index * 37) % 100}%`, animationDelay: `calc(var(--konfeti-jeda) * ${index % 10})` }}
          />
        ))}
      </div>
      <header className="projector-bar">
        <div>
          {base.room.quizTitle && <p className="muted">{base.room.quizTitle} selesai</p>}
          <h1 className="podium-title">Juara kelas hari ini</h1>
        </div>
        <div className="podium-actions">
          <button type="button" className="button button-tinta button-large" onClick={onReport}>
            Lihat rapor kelas
          </button>
          <button type="button" className="link-button" onClick={onDone}>
            Tutup ruang
          </button>
        </div>
      </header>
      <div className="podium-stage">
        <Logo animate />
        {podium.top.length === 0 ? (
          <p className="empty">Belum ada skor.</p>
        ) : (
          <ol className="podium-blocks">
            {blocks.map(({ entry, place, order }) =>
              entry ? (
                <li key={entry.playerId} className={`podium-place podium-place-${place}`}>
                  <span className="podium-name">{entry.nickname}</span>
                  <span className="podium-points">{numberFormat.format(entry.score)} poin</span>
                  <span className="podium-block-wrap">
                    <RiseIn axis="y" order={order}>
                      <span className="podium-block">{entry.rank}</span>
                    </RiseIn>
                  </span>
                </li>
              ) : null,
            )}
          </ol>
        )}
      </div>
      <p className="podium-footer">{podium.playerCount} pemain.</p>
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
