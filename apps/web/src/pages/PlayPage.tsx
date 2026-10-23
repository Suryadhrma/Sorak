import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  CHEER_ENERGY_MAX,
  CHEER_VIBRATE_MS,
  NICKNAME_MAX_LENGTH,
  Nickname,
  Pin,
  type PlayerServerMessage,
  type RoomLookup,
} from "@sorak/shared";
import { AnswerButton, AnswerCard, AnswerTile, answerLetter, answersClass } from "../AnswerOption.tsx";
import { ApiRequestError, describeError, lookupRoom } from "../api.ts";
import { energyLevel, fullEnergy, spendCheer } from "../cheer-energy.ts";
import { HandIcon, Logo } from "../Logo.tsx";
import { Countdown } from "../motion/Countdown.tsx";
import { FlapDigits } from "../motion/FlapDigits.tsx";
import { RaiseIn } from "../motion/RaiseIn.tsx";
import { Tally } from "../motion/Tally.tsx";
import { initialPlayerScreen, rankClimb, type PlayerScreen, type PlayerView, type Standing } from "../player-screen.ts";
import { createPlayerSession, hasSavedSession, type PlayerSession } from "../player-session.ts";
import type { ConnectionStatus } from "../socket.ts";
import { useRemainingMs } from "../useRemainingMs.ts";
import { useTheme } from "../theme.ts";

/** lookup null: cek PIN dilewati karena HP ini sudah punya sesi (langsung resume). */
type CheckState = { kind: "checking" } | { kind: "ready"; lookup: RoomLookup | null } | { kind: "error"; message: string };

type QuestionView = Extract<PlayerView, { kind: "question" }>;
type ResultView = Extract<PlayerView, { kind: "result" }>;
type FinalMessage = Extract<PlayerServerMessage, { t: "final" }>;

const numberFormat = new Intl.NumberFormat("id-ID");
const secondsFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const formatPin = (pin: string) => `${pin.slice(0, 3)} ${pin.slice(3)}`;

function lookupMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "NOT_FOUND") return "PIN tidak ditemukan. Periksa lagi PIN dari gurumu.";
  if (error instanceof ApiRequestError && error.code === "RATE_LIMITED") {
    return "Terlalu banyak yang mencoba masuk dari jaringan ini. Tunggu sebentar, lalu coba lagi.";
  }
  // ROOM_FULL dan GAME_ALREADY_STARTED sudah membawa pesan yang jelas dari server.
  return describeError(error);
}

function initialCheck(pin: Pin | null): CheckState {
  if (!pin) return { kind: "error", message: "PIN terdiri dari 6 angka." };
  // Muat ulang atau tab kedua di tengah game: cek PIN akan menjawab "sudah dimulai", padahal HP ini peserta.
  // Langsung resume; token yang tidak berlaku ditolak server dengan 4003.
  if (hasSavedSession(pin)) return { kind: "ready", lookup: null };
  return { kind: "checking" };
}

export function PlayPage() {
  useTheme("papan");
  const params = useParams();
  const navigate = useNavigate();
  const parsed = Pin.safeParse(params.pin);
  const pin = parsed.success ? parsed.data : null;
  const [check, setCheck] = useState<CheckState>(() => initialCheck(pin));
  const [screen, setScreen] = useState<PlayerScreen>(initialPlayerScreen);
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting", attempt: 0 });
  const session = useRef<PlayerSession | null>(null);

  useEffect(() => {
    if (!pin || check.kind !== "checking") return;
    let active = true;
    lookupRoom(pin)
      .then((lookup) => {
        if (active) setCheck({ kind: "ready", lookup });
      })
      .catch((error: unknown) => {
        if (active) setCheck({ kind: "error", message: lookupMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [pin, check.kind]);

  useEffect(() => {
    if (!pin || check.kind !== "ready") return;
    const current = createPlayerSession(pin, setScreen, setStatus);
    session.current = current;
    current.start();
    return () => {
      current.stop();
      session.current = null;
    };
  }, [pin, check.kind]);

  if (check.kind === "checking") return <Status text="Mengecek PIN…" />;
  if (check.kind === "error" || !pin) return <Ended message={check.kind === "error" ? check.message : "PIN tidak valid."} />;

  const { view } = screen;
  // Terputus = sudah pernah tersambung lalu putus (bukan sambungan pertama).
  const offline = status.kind === "waiting" || (status.kind === "connecting" && status.attempt > 0);
  const retryNow = () => session.current?.retryNow();

  switch (view.kind) {
    case "connecting":
    case "syncing":
      if (offline) return <Disconnected status={status} duringQuestion={screen.lastPhase === "question"} onRetry={retryNow} />;
      return <Status text="Menyambung ke room…" />;
    case "nickname":
      return (
        <NicknameForm
          pin={pin}
          lookup={check.lookup}
          error={view.error}
          busy={view.busy}
          onSubmit={(name) => session.current?.join(name)}
        />
      );
    case "lobby":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return (
        <Lobby
          pin={pin}
          nickname={view.me.nickname}
          playerCount={view.playerCount}
          cheerTotal={view.cheerTotal}
          onCheer={() => session.current?.cheer()}
          onLeave={() => {
            session.current?.leave();
            navigate("/");
          }}
        />
      );
    case "question":
      // Soal tetap tampil saat sinyal putus: jawaban yang ditekan masuk antrean dan dikirim begitu tersambung.
      return (
        <QuestionScreen
          view={view}
          standing={screen.standing}
          offline={offline ? status : null}
          onAnswer={(choice) => session.current?.answer(choice)}
          onRetry={retryNow}
        />
      );
    case "grace":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return (
        <main className="hp-screen">
          <h1 className="hp-title">Menghitung jawaban…</h1>
          <WaitingPanel text={view.answered ? "Jawabanmu sudah masuk. Hasil muncul sebentar lagi." : "Kamu tidak menjawab soal ini."} />
        </main>
      );
    case "result":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return <ResultScreen view={view} />;
    case "final":
      return <FinalScreen final={view.final} quizTitle={screen.quizTitle} />;
    case "ended":
      return <Ended message={view.message} onTakeOver={view.takeOver ? () => session.current?.takeOver() : undefined} />;
  }
}

/** HP-2: nama di papan skor. Judul dan jumlah teman hanya kalau cek PIN sudah memuatnya. */
function NicknameForm(props: {
  pin: Pin;
  lookup: RoomLookup | null;
  error: string | null;
  busy: boolean;
  onSubmit: (nickname: string) => void;
}) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError ?? props.error;
  const friends = props.lookup?.playerCount ?? 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Nickname.safeParse(value);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "Nickname belum valid.");
      return;
    }
    setLocalError(null);
    props.onSubmit(parsed.data);
  }

  return (
    <main className="hp-screen">
      <div className="hp-topbar">
        <Link to="/">Ganti PIN</Link>
        <span>PIN {formatPin(props.pin)}</span>
      </div>
      {props.lookup?.quizTitle && (
        <div>
          <p className="muted">Kamu masuk ke</p>
          <h1 className="hp-title">{props.lookup.quizTitle}</h1>
        </div>
      )}
      <form className="hp-stack hp-fill" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="nickname">Nama kamu di papan skor</label>
          <input
            id="nickname"
            className="name-input"
            autoComplete="off"
            maxLength={NICKNAME_MAX_LENGTH}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
            aria-describedby="nickname-hint"
            {...(shown ? { "aria-invalid": true } : {})}
          />
          <p id="nickname-hint" className="hp-row muted">
            <span>Pakai nama panggilan yang dikenal guru.</span>
            <span>
              {Array.from(value).length} dari {NICKNAME_MAX_LENGTH}
            </span>
          </p>
          {shown && (
            <p className="field-error" role="alert">
              {shown}
            </p>
          )}
        </div>
        <div className="hp-bottom hp-stack">
          {friends > 0 && (
            <p className="hp-row-start">
              <Tally count={friends} label={`${friends} teman`} />
              <span>{friends} teman sudah di sini</span>
            </p>
          )}
          <button type="submit" className="button button-primary button-block button-hp" disabled={props.busy}>
            {props.busy ? "Masuk…" : "Gabung ke kelas"}
          </button>
        </div>
      </form>
    </main>
  );
}

/** HP-3: lobby dengan tombol Sorak. */
function Lobby(props: {
  pin: Pin;
  nickname: string;
  playerCount: number;
  cheerTotal: number;
  onCheer: () => void;
  onLeave: () => void;
}) {
  return (
    <main className="hp-screen">
      <div className="hp-topbar">
        <Logo />
        <span>PIN {formatPin(props.pin)}</span>
      </div>
      <div>
        <p className="muted">Namamu sudah di papan</p>
        <h1 className="hp-name">{props.nickname}</h1>
      </div>
      <p className="hp-row-start" role="status" aria-live="polite">
        <Tally count={props.playerCount} label={`${props.playerCount} pemain`} />
        <span>{props.playerCount} teman di ruang ini</span>
      </p>
      <p className="hp-pill">Tunggu guru memulai</p>
      <CheerPad total={props.cheerTotal} onCheer={props.onCheer} />
      <div className="hp-bottom">
        <button type="button" className="link-button" onClick={props.onLeave}>
          Keluar dari ruang
        </button>
      </div>
    </main>
  );
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tombol Sorak (B5): setiap tekan memakai satu garis tenaga dan menerbangkan tangan kecil. Tenaga habis: tombol
 * tetap bisa ditekan, tidak mengirim apa pun, dan bergetar kecil. Getar HP hanya kalau didukung (Safari iPhone tidak).
 */
function CheerPad({ total, onCheer }: { total: number; onCheer: () => void }) {
  const button = useRef<HTMLButtonElement | null>(null);
  const [energy, setEnergy] = useState(() => fullEnergy(performance.now()));
  const [now, setNow] = useState(() => performance.now());
  // Tangan yang sedang terbang; id naik terus supaya setiap tangan dipasang baru dan animasinya diputar sekali.
  const [flies, setFlies] = useState<number[]>([]);
  const level = energyLevel(energy, now);
  const full = level >= CHEER_ENERGY_MAX;

  // Garis tenaga terisi pelan: render ulang tiap 100 ms, hanya selama belum penuh.
  useEffect(() => {
    if (full) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [full]);

  function press() {
    const at = performance.now();
    const spent = spendCheer(energy, at);
    setEnergy(spent.energy);
    setNow(at);
    if (!spent.sent) {
      if (!reducedMotion()) {
        button.current?.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
          { duration: 240, easing: "ease-in-out" },
        );
      }
      return;
    }
    onCheer();
    if ("vibrate" in navigator) navigator.vibrate(CHEER_VIBRATE_MS);
    setFlies((current) => [...current, (current.at(-1) ?? 0) + 1].slice(-CHEER_ENERGY_MAX));
  }

  const whole = Math.floor(level);
  return (
    <section className="cheer-pad" aria-label="Sorak">
      <div className="cheer-flies" aria-hidden="true">
        {flies.map((id) => (
          <span key={id} className="cheer-fly" style={{ "--urutan": id % CHEER_ENERGY_MAX }}>
            <HandIcon className="cheer-fly-hand" />
          </span>
        ))}
      </div>
      <button ref={button} type="button" className="cheer-button" onClick={press}>
        <HandIcon className="cheer-button-hand" />
        <span className="cheer-button-text">Sorak!</span>
      </button>
      <div className="hp-row">
        <p className="cheer-energy">
          <svg className="cheer-energy-lines" viewBox="0 0 84 30" role="img" aria-label={`Tenaga sorak ${whole} dari ${CHEER_ENERGY_MAX}`}>
            {Array.from({ length: CHEER_ENERGY_MAX }, (_, i) => (
              <g key={i}>
                <line className="cheer-energy-empty" x1={6 + i * 18} y1="4" x2={6 + i * 18} y2="26" />
                {i < whole && <line className="cheer-energy-full" x1={6 + i * 18} y1="4" x2={6 + i * 18} y2="26" />}
                {i === whole && !full && (
                  <line
                    className="cheer-energy-refill"
                    x1={6 + i * 18}
                    y1="4"
                    x2={6 + i * 18}
                    y2="26"
                    style={{ transform: `scaleY(${level - whole})` }}
                  />
                )}
              </g>
            ))}
          </svg>
          <span>
            tenaga sorak
            <span className="cheer-energy-hint">
              <br />
              terisi lagi sendiri
            </span>
          </span>
        </p>
        <p className="cheer-total">
          Kelas sudah bersorak
          <br />
          <span key={total} className="cheer-total-number">
            {numberFormat.format(total)}
          </span>{" "}
          kali
        </p>
      </div>
    </section>
  );
}

/** HP-4 (memilih) dan HP-5 (terkirim). */
function QuestionScreen(props: {
  view: QuestionView;
  standing: Standing;
  offline: ConnectionStatus | null;
  onAnswer: (choice: number) => void;
  onRetry: () => void;
}) {
  const { view, standing, offline } = props;
  const { question, choice, confirmed } = view;
  const timeUp = useRemainingMs(view.startedAt, view.durationMs) === 0;

  return (
    <main className="hp-screen">
      <div className="hp-topbar">
        <span className="muted">
          Soal {question.q + 1} dari {question.total}
        </span>
        <Countdown startedAt={view.startedAt} durationMs={view.durationMs} className="countdown-hp" />
      </div>
      {offline && (
        <div className="offline-banner" role="status">
          <p>
            <strong>Sinyal putus sebentar.</strong>
            {!timeUp && " Kalau tersambung sebelum waktunya habis, kamu masih bisa menjawab."}
          </p>
          <ReconnectProgress status={offline} />
          <button type="button" className="button" onClick={props.onRetry}>
            Sambung sekarang
          </button>
        </div>
      )}
      {choice === null ? (
        <>
          <h1 className="hp-prompt">{question.prompt}</h1>
          <p className="muted">{questionHint(confirmed, timeUp)}</p>
          <div className={`${answersClass(question.options.length)} hp-answers`}>
            {question.options.map((text, index) => (
              <RaiseIn key={index} index={index}>
                <AnswerButton
                  index={index}
                  text={text}
                  selected={false}
                  disabled={confirmed || timeUp}
                  onSelect={() => props.onAnswer(index)}
                />
              </RaiseIn>
            ))}
          </div>
          <StandingFooter standing={standing} />
        </>
      ) : (
        <SentAnswer view={view} choice={choice} offline={offline !== null} />
      )}
    </main>
  );
}

function questionHint(confirmed: boolean, timeUp: boolean): string {
  if (confirmed) return "Jawabanmu sudah masuk.";
  if (timeUp) return "Waktu habis.";
  return "Pilih satu. Jawaban tidak bisa diganti.";
}

function sentTitle(letter: string, confirmed: boolean, offline: boolean): string {
  if (confirmed) return `Jawaban ${letter} terkirim`;
  if (offline) return `Jawaban ${letter} tersimpan`;
  return `Mengirim jawaban ${letter}…`;
}

function remainingText(remaining: number | null): string {
  if (remaining === null) return "";
  if (remaining > 0) return `Masih ada ${remaining} soal.`;
  return "Ini soal terakhir.";
}

function SentAnswer({ view, choice, offline }: { view: QuestionView; choice: number; offline: boolean }) {
  const title = sentTitle(answerLetter(choice), view.confirmed, offline);
  return (
    <>
      <div className="sent-card sent-card-big">
        <AnswerCard index={choice} text={view.question.options[choice] ?? ""} />
        {view.confirmed && <CheckBadge />}
      </div>
      <div className="hp-center" role="status" aria-live="polite">
        <h1 className="hp-subtitle">{title}</h1>
        {offline && !view.confirmed && <p className="muted">Dikirim begitu tersambung.</p>}
        {view.elapsedMs !== null && (
          <p className="muted">Kamu menjawab di detik ke-{secondsFormat.format(view.elapsedMs / 1000)}.</p>
        )}
      </div>
      <WaitingPanel text="Hasil muncul saat waktu habis atau semua sudah menjawab." />
    </>
  );
}

/** Turus menunggu: gambar ulang pelan selama hasil belum datang (indikator tunggu, bukan animasi masuk). */
function WaitingPanel({ text }: { text: string }) {
  return (
    <div className="hp-panel hp-bottom">
      <span className="tally-waiting" aria-hidden="true">
        <Tally count={5} label="Menunggu hasil" />
      </span>
      <p>{text}</p>
    </div>
  );
}

function StandingFooter({ standing }: { standing: Standing }) {
  return (
    <p className="hp-row hp-footer">
      <span>{standing.streak >= 2 ? <ComboLabel streak={standing.streak} /> : null}</span>
      <span>{numberFormat.format(standing.score)} poin</span>
    </p>
  );
}

function ComboLabel({ streak }: { streak: number }) {
  return (
    <span className="hp-row-start">
      <span aria-hidden="true">
        <Tally count={Math.min(streak, 5)} label={`Kombo ${streak}`} />
      </span>
      Kombo {streak}
    </span>
  );
}

function CheckBadge() {
  return (
    <span className="check-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M5 12.5 10 17.5 19 7" />
      </svg>
    </span>
  );
}

/** HP-6 (benar) dan HP-7 (salah / tidak menjawab). */
function ResultScreen({ view }: { view: ResultView }) {
  const { result, previous, question, choice } = view;
  const heading = question ? `Soal ${result.q + 1} dari ${question.total}` : `Soal ${result.q + 1}`;

  if (result.outcome === "correct") {
    const climb = rankClimb(previous.rank, result.rank);
    return (
      <main className="hp-screen hp-correct">
        <span className="muted">{heading}</span>
        <div className="hp-center">
          <Logo animate />
          <h1 className="hp-verdict">Benar</h1>
          <p className="score-big">
            <FlapDigits value={`+${result.points}`} />
          </p>
          <p>poin untuk soal ini</p>
          {/* Angka bonus kombo tidak ditampilkan: rumusnya ada di server. */}
          {result.streak >= 2 && <p className="hp-pill hp-pill-kapur">Kombo {result.streak}</p>}
        </div>
        <div className="hp-panel hp-bottom hp-row">
          <span>
            <span className="muted">Peringkatmu sekarang</span>
            {climb !== null && <strong className="hp-block">Naik {climb} tingkat</strong>}
          </span>
          <span className="rank-pair">
            {climb !== null && previous.rank !== null && <s className="rank-old">{previous.rank}</s>}
            <span className="rank-tile">{result.rank}</span>
          </span>
        </div>
        <p className="hp-center muted">Total {numberFormat.format(result.score)} poin</p>
      </main>
    );
  }

  const remaining = question ? question.total - (result.q + 1) : null;
  const correctText = question?.options[result.correctIndex];
  const chosenText = choice === null ? undefined : question?.options[choice];
  return (
    <main className="hp-screen">
      <span className="muted">{heading}</span>
      <h1 className="hp-verdict">{result.outcome === "wrong" ? "Belum tepat" : "Tidak menjawab"}</h1>
      <p className="muted">
        {remainingText(remaining)}
        {result.points >= 0 && " Poinmu tidak berkurang."}
      </p>
      {result.outcome === "wrong" && choice !== null && chosenText !== undefined && (
        <div className="hp-stack">
          <p className="muted">Jawabanmu</p>
          <AnswerCard index={choice} text={chosenText} className="answer-strip answer-struck" />
        </div>
      )}
      <div className="hp-stack">
        <p className="muted">Jawaban yang benar</p>
        {correctText === undefined ? (
          <p className="hp-row-start">
            <AnswerTile index={result.correctIndex} /> Pilihan {answerLetter(result.correctIndex)}
          </p>
        ) : (
          <div className="sent-card">
            <AnswerCard index={result.correctIndex} text={correctText} className="answer-strip answer-correct" />
            <CheckBadge />
          </div>
        )}
      </div>
      <p className="hp-row hp-footer hp-bottom">
        <span>{previous.streak >= 2 ? "Kombo terputus" : ""}</span>
        <span>
          {numberFormat.format(result.score)} poin, peringkat {result.rank}
        </span>
      </p>
    </main>
  );
}

/** HP-8: rapor akhir. Baris hanya untuk data yang ada (correctCount dari GameRoom baru, B4). */
function FinalScreen({ final, quizTitle }: { final: FinalMessage; quizTitle: string | null }) {
  const { highlights } = final;
  const rows: [string, string][] = [];
  if (final.correctCount !== undefined && final.questionCount !== undefined) {
    rows.push(["Jawaban benar", `${final.correctCount} dari ${final.questionCount}`]);
  }
  if (highlights.bestStreak > 0) rows.push(["Kombo terpanjang", `${highlights.bestStreak} soal`]);
  if (highlights.fastestCorrectMs !== null) {
    rows.push(["Jawaban benar tercepat", `${secondsFormat.format(highlights.fastestCorrectMs / 1000)} detik`]);
  }
  if (highlights.biggestRankClimb > 0) rows.push(["Naik peringkat terbanyak", `${highlights.biggestRankClimb} tingkat`]);

  return (
    <main className="hp-screen">
      <div className="hp-topbar">
        <Logo />
        {quizTitle && <span className="muted">{quizTitle}</span>}
      </div>
      <p className="muted">Game selesai. Peringkatmu</p>
      <div className="hp-row-start final-rank">
        <span className="rank-tile rank-tile-big">{final.rank}</span>
        <span>
          <strong className="hp-subtitle">dari {final.playerCount}</strong>
          <span className="hp-block muted">{numberFormat.format(final.score)} poin</span>
        </span>
      </div>
      {rows.length > 0 && (
        <section className="rapor" aria-labelledby="rapor-title">
          <h2 id="rapor-title">Rapor kuismu</h2>
          <dl>
            {rows.map(([label, value]) => (
              <div key={label} className="rapor-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className="hp-bottom">
        <Link className="button button-primary button-block button-hp" to="/">
          Main kuis lain
        </Link>
      </div>
    </main>
  );
}

/** HP-9: layar terputus. Sorak menyambung lagi sendiri; pemain bisa mempercepatnya. */
function Disconnected({ status, duringQuestion, onRetry }: { status: ConnectionStatus; duringQuestion: boolean; onRetry: () => void }) {
  const attempt = status.kind === "open" ? 0 : status.attempt;
  return (
    <main className="hp-screen">
      <div className="hp-center disconnected">
        <Logo />
        <h1 className="hp-subtitle">Sinyal putus sebentar</h1>
        <p className="muted">Jawaban yang sudah terkirim tetap aman. Sorak menyambung lagi sendiri.</p>
      </div>
      <div className="hp-panel hp-row">
        <span className="hp-row-start">
          <span aria-hidden="true">
            <Tally count={Math.max(1, Math.min(attempt, 5))} label={`Percobaan ke-${attempt + 1}`} />
          </span>
          <span>
            <strong className="hp-block">Mencoba lagi</strong>
            <span className="muted">Percobaan ke-{attempt + 1}</span>
          </span>
        </span>
        <ReconnectProgress status={status} />
      </div>
      {duringQuestion && <p className="muted">Soal masih berjalan. Kalau tersambung sebelum waktunya habis, kamu masih bisa menjawab.</p>}
      <div className="hp-bottom hp-stack">
        <button type="button" className="button button-primary button-block button-hp" onClick={onRetry}>
          Sambung sekarang
        </button>
        <Link className="hp-center" to="/">
          Masuk lagi dengan PIN
        </Link>
      </div>
    </main>
  );
}

function ReconnectProgress({ status }: { status: ConnectionStatus }) {
  if (status.kind === "waiting") return <RetryCountdown since={status.since} delayMs={status.delayMs} />;
  if (status.kind === "connecting") {
    return (
      <span className="rank-tile" role="status" aria-label="Sedang menyambung">
        …
      </span>
    );
  }
  return null;
}

function RetryCountdown({ since, delayMs }: { since: number; delayMs: number }) {
  const seconds = Math.ceil(useRemainingMs(since, delayMs) / 1000);
  return (
    <span className="rank-tile" role="status" aria-label={`Mencoba lagi dalam ${seconds} detik`}>
      {seconds}
    </span>
  );
}

function Status({ text }: { text: string }) {
  return (
    <p className="page-status" role="status">
      {text}
    </p>
  );
}

function Ended({ message, onTakeOver }: { message: string; onTakeOver?: (() => void) | undefined }) {
  return (
    <main className="hp-screen">
      <p className="alert" role="alert">
        {message}
      </p>
      {onTakeOver && (
        <button type="button" className="button button-primary button-block button-hp" onClick={onTakeOver}>
          Pakai di sini
        </button>
      )}
      <Link className="button button-block" to="/">
        Masukkan PIN lain
      </Link>
    </main>
  );
}
