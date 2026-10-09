import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { NICKNAME_MAX_LENGTH, Nickname, Pin } from "@sorak/shared";
import { ApiRequestError, describeError, lookupRoom } from "../api.ts";
import { AnswerButton } from "../AnswerOption.tsx";
import { createPlayerSession, type PlayerSession, type PlayerView } from "../player-session.ts";
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
  const [view, setView] = useState<PlayerView>({ kind: "connecting" });
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
    const current = createPlayerSession(pin, setView);
    session.current = current;
    current.start();
    return () => {
      current.stop();
      session.current = null;
    };
  }, [pin, check.kind]);

  if (check.kind === "checking") return <Status text="Mengecek PIN…" />;
  if (check.kind === "error") return <Ended message={check.message} />;

  switch (view.kind) {
    case "connecting":
      return <Status text="Menyambung ke room…" />;
    case "nickname":
      return <NicknameForm error={view.error} busy={view.busy} onSubmit={(name) => session.current?.join(name)} />;
    case "lobby":
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
      return <QuestionScreen view={view} onAnswer={(choice) => session.current?.answer(choice)} />;
    case "grace":
      return (
        <main className="page page-narrow lobby">
          <h1>Menghitung jawaban…</h1>
          <p className="muted">{view.answered ? "Jawabanmu sudah masuk." : "Kamu tidak menjawab soal ini."}</p>
        </main>
      );
    case "result":
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
      return (
        <Ended
          message={view.message}
          onRetry={view.canRetry ? () => session.current?.retry() : undefined}
        />
      );
  }
}

function Status({ text }: { text: string }) {
  return (
    <p className="page-status" role="status">
      {text}
    </p>
  );
}

function Ended({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }) {
  return (
    <main className="page page-narrow">
      <p className="alert" role="alert">
        {message}
      </p>
      {onRetry && (
        <button type="button" className="button button-primary button-block" onClick={onRetry}>
          Masuk lagi
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

function QuestionScreen({ view, onAnswer }: { view: QuestionView; onAnswer: (choice: number) => void }) {
  const { question, choice, confirmed } = view;
  const remaining = useRemainingMs(view.startedAt, question.durationMs);
  const timeUp = remaining === 0;

  return (
    <main className="page page-narrow">
      <div className="question-meta">
        <span className="muted">
          Soal {question.q + 1}/{question.total}
        </span>
        <span className="countdown" role="timer" aria-label={`Sisa waktu ${Math.ceil(remaining / 1000)} detik`}>
          {Math.ceil(remaining / 1000)}
        </span>
      </div>
      <h1 className="question-prompt">{question.prompt}</h1>
      <div className="answers">
        {question.options.map((text, index) => (
          <AnswerButton
            key={index}
            index={index}
            text={text}
            selected={choice === index}
            disabled={choice !== null || timeUp}
            onSelect={() => onAnswer(index)}
          />
        ))}
      </div>
      <p className="muted" role="status" aria-live="polite">
        {answerStatus(choice, confirmed, timeUp)}
      </p>
    </main>
  );
}

function answerStatus(choice: number | null, confirmed: boolean, timeUp: boolean): string {
  if (confirmed) return "Jawaban terkirim.";
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
