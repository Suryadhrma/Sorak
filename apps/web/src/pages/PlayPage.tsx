import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { NICKNAME_MAX_LENGTH, Nickname, Pin } from "@sorak/shared";
import { ApiRequestError, describeError, lookupRoom } from "../api.ts";
import { AnswerButton, answersClass } from "../AnswerOption.tsx";
import { initialPlayerScreen, type PlayerScreen, type PlayerView } from "../player-screen.ts";
import { createPlayerSession, type PlayerSession } from "../player-session.ts";
import type { ConnectionStatus } from "../socket.ts";
import { useRemainingMs } from "../useRemainingMs.ts";
import { useTheme } from "../theme.ts";

type CheckState = { kind: "checking" } | { kind: "ready" } | { kind: "error"; message: string };

function lookupMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "NOT_FOUND") return "PIN tidak ditemukan. Periksa lagi PIN dari gurumu.";
  if (error instanceof ApiRequestError && error.code === "RATE_LIMITED") {
    return "Terlalu banyak yang mencoba masuk dari jaringan ini. Tunggu sebentar, lalu coba lagi.";
  }
  // ROOM_FULL dan GAME_ALREADY_STARTED sudah membawa pesan yang jelas dari server.
  return describeError(error);
}

export function PlayPage() {
  useTheme("papan");
  const params = useParams();
  const parsed = Pin.safeParse(params.pin);
  const pin = parsed.success ? parsed.data : null;
  const [check, setCheck] = useState<CheckState>(
    pin ? { kind: "checking" } : { kind: "error", message: "PIN terdiri dari 6 angka." },
  );
  const [screen, setScreen] = useState<PlayerScreen>(initialPlayerScreen);
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting", attempt: 0 });
  const session = useRef<PlayerSession | null>(null);

  useEffect(() => {
    if (!pin) return;
    let active = true;
    lookupRoom(pin)
      .then(() => {
        if (active) setCheck({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (active) setCheck({ kind: "error", message: lookupMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [pin]);

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
  if (check.kind === "error") return <Ended message={check.message} />;

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
      return <NicknameForm error={view.error} busy={view.busy} onSubmit={(name) => session.current?.join(name)} />;
    case "lobby":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return (
        <main className="page page-narrow lobby">
          <p className="lobby-nickname">{view.me.nickname}</p>
          <h1>Kamu sudah masuk</h1>
          <p>Tunggu guru memulai.</p>
          <p className="muted" role="status" aria-live="polite">
            {view.playerCount} pemain di room
          </p>
        </main>
      );
    case "question":
      // Soal tetap tampil saat sinyal putus: jawaban yang ditekan masuk antrean dan dikirim begitu tersambung.
      return (
        <QuestionScreen
          view={view}
          offline={offline ? status : null}
          onAnswer={(choice) => session.current?.answer(choice)}
          onRetry={retryNow}
        />
      );
    case "grace":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return (
        <main className="page page-narrow lobby">
          <h1>Menghitung jawaban…</h1>
          <p className="muted">{view.answered ? "Jawabanmu sudah masuk." : "Kamu tidak menjawab soal ini."}</p>
        </main>
      );
    case "result":
      if (offline) return <Disconnected status={status} duringQuestion={false} onRetry={retryNow} />;
      return <ResultScreen result={view.result} />;
    case "final":
      return (
        <main className="page page-narrow lobby">
          <p className="lobby-nickname">{view.me.nickname}</p>
          <h1>Permainan selesai</h1>
          <p className="score-big">{view.final.score} poin</p>
          <p>
            Peringkat {view.final.rank} dari {view.final.playerCount}
          </p>
          <Link className="button" to="/">
            Masukkan PIN lain
          </Link>
        </main>
      );
    case "ended":
      return <Ended message={view.message} onTakeOver={view.takeOver ? () => session.current?.takeOver() : undefined} />;
  }
}

/** Layar "HP: Koneksi terputus": Sorak menyambung lagi sendiri; pemain bisa mempercepatnya. */
function Disconnected({ status, duringQuestion, onRetry }: { status: ConnectionStatus; duringQuestion: boolean; onRetry: () => void }) {
  return (
    <main className="page page-narrow lobby">
      <h1>Sinyal putus sebentar</h1>
      <p>Jawaban yang sudah terkirim tetap aman. Sorak menyambung lagi sendiri.</p>
      {duringQuestion && <p>Kalau tersambung sebelum waktunya habis, kamu masih bisa menjawab.</p>}
      <ReconnectProgress status={status} />
      <button type="button" className="button button-primary button-block" onClick={onRetry}>
        Sambung sekarang
      </button>
    </main>
  );
}

function ReconnectProgress({ status }: { status: ConnectionStatus }) {
  if (status.kind === "waiting") return <RetryCountdown attempt={status.attempt} since={status.since} delayMs={status.delayMs} />;
  if (status.kind === "connecting") {
    return (
      <p className="muted" role="status">
        Percobaan ke-{status.attempt + 1}: menyambung…
      </p>
    );
  }
  return null;
}

function RetryCountdown({ attempt, since, delayMs }: { attempt: number; since: number; delayMs: number }) {
  const remaining = useRemainingMs(since, delayMs);
  return (
    <p className="muted" role="status">
      Percobaan ke-{attempt + 1} dalam {Math.ceil(remaining / 1000)} detik
    </p>
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
    <main className="page page-narrow">
      <p className="alert" role="alert">
        {message}
      </p>
      {onTakeOver && (
        <button type="button" className="button button-primary button-block" onClick={onTakeOver}>
          Pakai di sini
        </button>
      )}
      <Link className="button" to="/">
        Masukkan PIN lain
      </Link>
    </main>
  );
}

function NicknameForm({ error, busy, onSubmit }: { error: string | null; busy: boolean; onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError ?? error;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Nickname.safeParse(value);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "Nickname belum valid.");
      return;
    }
    setLocalError(null);
    onSubmit(parsed.data);
  }

  return (
    <main className="page page-narrow">
      <h1>Pilih nickname</h1>
      <form className="join-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="nickname">Nickname</label>
          <input
            id="nickname"
            autoComplete="off"
            maxLength={NICKNAME_MAX_LENGTH}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
            {...(shown ? { "aria-invalid": true, "aria-describedby": "nickname-error" } : {})}
          />
          {shown && (
            <p id="nickname-error" className="field-error">
              {shown}
            </p>
          )}
        </div>
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          {busy ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}

type QuestionView = Extract<PlayerView, { kind: "question" }>;
type ResultView = Extract<PlayerView, { kind: "result" }>;

function QuestionScreen({
  view,
  offline,
  onAnswer,
  onRetry,
}: {
  view: QuestionView;
  offline: ConnectionStatus | null;
  onAnswer: (choice: number) => void;
  onRetry: () => void;
}) {
  const { question, choice, confirmed } = view;
  const remaining = useRemainingMs(view.startedAt, view.durationMs);
  const timeUp = remaining === 0;

  return (
    <main className="page page-narrow">
      {offline && (
        <div className="offline-banner" role="status">
          <p>
            <strong>Sinyal putus sebentar.</strong> Kalau tersambung sebelum waktunya habis, kamu masih bisa menjawab.
          </p>
          <ReconnectProgress status={offline} />
          <button type="button" className="button" onClick={onRetry}>
            Sambung sekarang
          </button>
        </div>
      )}
      <div className="question-meta">
        <span className="muted">
          Soal {question.q + 1}/{question.total}
        </span>
        <span className="countdown" role="timer" aria-label={`Sisa waktu ${Math.ceil(remaining / 1000)} detik`}>
          {Math.ceil(remaining / 1000)}
        </span>
      </div>
      <h1 className="question-prompt">{question.prompt}</h1>
      <div className={answersClass(question.options.length)}>
        {question.options.map((text, index) => (
          <AnswerButton
            key={index}
            index={index}
            text={text}
            selected={choice === index}
            disabled={choice !== null || confirmed || timeUp}
            onSelect={() => onAnswer(index)}
          />
        ))}
      </div>
      <p className="muted" role="status" aria-live="polite">
        {answerStatus(choice, confirmed, timeUp, offline !== null)}
      </p>
    </main>
  );
}

function answerStatus(choice: number | null, confirmed: boolean, timeUp: boolean, offline: boolean): string {
  if (confirmed) return "Jawaban terkirim.";
  if (choice !== null && offline) return "Tersimpan. Dikirim begitu tersambung.";
  if (choice !== null) return "Mengirim…";
  if (timeUp) return "Waktu habis.";
  return "";
}

const OUTCOME_TITLES = { correct: "Benar!", wrong: "Salah", no_answer: "Tidak menjawab" } as const;

function ResultScreen({ result }: { result: ResultView["result"] }) {
  return (
    <main className={`page page-narrow lobby result-${result.outcome}`}>
      <h1 className="result-title">{OUTCOME_TITLES[result.outcome]}</h1>
      <p className="score-big">+{result.points}</p>
      {result.streak >= 2 && <p className="combo">Kombo {result.streak}×</p>}
      <p>
        Total {result.score} poin · Peringkat {result.rank}
      </p>
      <p className="muted">Tunggu guru melanjutkan.</p>
    </main>
  );
}
