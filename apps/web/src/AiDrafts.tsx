import { useEffect, useId, useRef } from "react";
import { AI_QUESTION_COUNTS, AI_SOURCE_MAX_CHARS, AI_SOURCE_MIN_CHARS, MAX_QUESTIONS_PER_QUIZ } from "@sorak/shared";
import { AnswerTile, answerLetter } from "./AnswerOption.tsx";
import { CheckMark } from "./CheckMark.tsx";
import type { AiFlow, ReviewDraft, ReviewEdit } from "./ai-draft.ts";
import { Tally } from "./motion/Tally.tsx";
import { useRemainingMs } from "./useRemainingMs.ts";

export type AiCount = (typeof AI_QUESTION_COUNTS)[number];

const formatCount = (n: number) => n.toLocaleString("id-ID");

/** Hitung mundur AI_RATE_LIMITED. Komponen sendiri supaya hook waktunya hanya berjalan selama pesan ini tampil. */
function RetryCountdown(props: { retry: { startedAt: number; durationMs: number }; onWaiting: (waiting: boolean) => void }) {
  const { retry, onWaiting } = props;
  const seconds = Math.ceil(useRemainingMs(retry.startedAt, retry.durationMs) / 1000);
  useEffect(() => onWaiting(seconds > 0), [seconds, onWaiting]);
  return (
    <p className="alert" role="alert">
      {seconds > 0 ? `Server AI sedang sibuk. Coba lagi dalam ${seconds} detik.` : "Server AI sudah bisa dicoba lagi."}
    </p>
  );
}

/**
 * Dialog "Buat dari materi": materi, jumlah soal, lalu menunggu AI. <dialog> bawaan browser seperti dialog Mainkan:
 * fokus terkunci di dialog, Esc menutupnya (dan membatalkan permintaan yang sedang berjalan).
 */
export function AiMaterialDialog(props: {
  flow: Extract<AiFlow, { kind: "idle" | "loading" | "error" }>;
  quotaMessage: string | null;
  sourceText: string;
  count: AiCount;
  sourceError: string | undefined;
  waitingRetry: boolean;
  onSourceText: (text: string) => void;
  onCount: (count: AiCount) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onClose: () => void;
  /** Dipanggil hitung mundur; sebaiknya setter useState supaya stabil. */
  onWaitingRetry: (waiting: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const sourceId = useId();
  const loading = props.flow.kind === "loading";
  const length = props.sourceText.trim().length;
  const tooLong = length > AI_SOURCE_MAX_CHARS;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const blockedReason = props.quotaMessage ?? (props.waitingRetry ? "Tunggu hitung mundur selesai." : null);

  return (
    <dialog ref={dialog} className="mode-dialog ai-dialog" aria-labelledby={titleId} onCancel={props.onClose}>
      <p className="muted-strong">Buat dari materi</p>
      <h2 id={titleId} className="mode-dialog-title">
        Draf soal dari teks pelajaran
      </h2>

      {loading ? (
        <div className="ai-tunggu" role="status">
          <span className="tally-waiting" aria-hidden="true">
            <Tally count={5} label="Menunggu AI" />
          </span>
          <p className="ai-tunggu-teks">AI sedang menyusun soal…</p>
          <p className="muted">Biasanya selesai dalam 5 sampai 20 detik.</p>
        </div>
      ) : (
        <>
          <p className="buku-lead">
            AI menyusun draf pilihan ganda hanya dari teks ini. Kamu memeriksa dan memilih dulu; tidak ada yang masuk kuis
            sebelum kamu menambahkannya.
          </p>
          <div className="field">
            <label htmlFor={sourceId}>Tempel materi pelajaran</label>
            <textarea
              id={sourceId}
              className="ai-materi"
              rows={9}
              value={props.sourceText}
              onChange={(event) => props.onSourceText(event.target.value)}
              aria-describedby={`${sourceId}-hitung${props.sourceError ? ` ${sourceId}-error` : ""}`}
              aria-invalid={props.sourceError ? true : undefined}
            />
            <p id={`${sourceId}-hitung`} className={tooLong ? "ai-hitung ai-hitung-lewat" : "ai-hitung"}>
              {formatCount(length)} / {formatCount(AI_SOURCE_MAX_CHARS)} huruf
              {length < AI_SOURCE_MIN_CHARS && ` (minimal ${formatCount(AI_SOURCE_MIN_CHARS)})`}
            </p>
            {props.sourceError && (
              <p id={`${sourceId}-error`} className="field-error">
                {props.sourceError}
              </p>
            )}
          </div>
          <fieldset className="ai-jumlah">
            <legend>Jumlah soal</legend>
            {AI_QUESTION_COUNTS.map((option) => (
              <label key={option} className="ai-jumlah-pil">
                <input
                  type="radio"
                  name={`${sourceId}-jumlah`}
                  checked={props.count === option}
                  onChange={() => props.onCount(option)}
                />
                {option} soal
              </label>
            ))}
          </fieldset>
        </>
      )}

      {props.flow.kind === "error" &&
        (props.flow.retry ? (
          <RetryCountdown retry={props.flow.retry} onWaiting={props.onWaitingRetry} />
        ) : (
          <p className="alert" role="alert">
            {props.flow.message}
          </p>
        ))}
      {props.quotaMessage && props.flow.kind !== "error" && (
        <p className="alert" role="alert">
          {props.quotaMessage}
        </p>
      )}

      <div className="mode-dialog-actions">
        {loading ? (
          <button type="button" className="button" onClick={props.onCancel}>
            Batal
          </button>
        ) : (
          <>
            <button type="button" className="button button-teks" onClick={props.onClose}>
              Tutup
            </button>
            <button
              type="button"
              className="button button-tinta"
              onClick={props.onGenerate}
              disabled={blockedReason !== null}
              title={blockedReason ?? undefined}
            >
              Buat draf soal
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

function reviewNote(selected: number, room: number): string | null {
  if (selected === 0) return "Centang minimal satu soal.";
  if (selected > room) {
    return room === 0
      ? `Kuis sudah berisi ${MAX_QUESTIONS_PER_QUIZ} soal, batas paling banyak.`
      : `Kuis paling banyak ${MAX_QUESTIONS_PER_QUIZ} soal; masih ada tempat untuk ${room} soal.`;
  }
  return null;
}

/** Satu draf AI, dengan isian yang sama dengan kartu soal editor supaya guru bisa langsung membetulkannya. */
function DraftCard({ draft, number, onEdit }: { draft: ReviewDraft; number: number; onEdit: (patch: ReviewEdit) => void }) {
  const fieldId = (name: string) => `${draft.key}-${name}`;
  const warningId = fieldId("peringatan");
  return (
    <li className={draft.selected ? "ai-draf" : "ai-draf ai-draf-dilewati"} style={{ "--urutan": number - 1 }}>
      <fieldset aria-describedby={draft.source.grounded ? undefined : warningId}>
        <legend>Draf {number}</legend>

        <label className="ai-draf-pakai">
          <input type="checkbox" checked={draft.selected} onChange={(event) => onEdit({ selected: event.target.checked })} />
          Pakai soal ini
        </label>

        {!draft.source.grounded && (
          <p id={warningId} className="ai-draf-peringatan">
            Bukti tidak ditemukan di materi; periksa jawabannya.
          </p>
        )}

        <div className="field">
          <label htmlFor={fieldId("prompt")}>Pertanyaan</label>
          <textarea
            id={fieldId("prompt")}
            className="editor-pertanyaan"
            rows={2}
            value={draft.prompt}
            onChange={(event) => onEdit({ prompt: event.target.value })}
          />
        </div>

        <fieldset className="options">
          <legend>Pilihan jawaban</legend>
          {draft.options.map((option, optionIndex) => {
            const letter = answerLetter(optionIndex);
            const correct = draft.correctIndex === optionIndex;
            return (
              <div key={optionIndex} className="option-row ai-pilihan">
                <AnswerTile index={optionIndex} />
                <label htmlFor={fieldId(`option-${optionIndex}`)} className="visually-hidden">
                  Pilihan {letter}
                </label>
                <input
                  id={fieldId(`option-${optionIndex}`)}
                  value={option}
                  onChange={(event) =>
                    onEdit({ options: draft.options.map((text, i) => (i === optionIndex ? event.target.value : text)) })
                  }
                />
                <label className="tandai-benar">
                  <input
                    type="radio"
                    name={fieldId("correct")}
                    aria-label={`Jadikan pilihan ${letter} jawaban benar`}
                    checked={correct}
                    onChange={() => onEdit({ correctIndex: optionIndex })}
                  />
                  {correct && <CheckMark />}
                  {correct ? "Jawaban benar" : "Tandai benar"}
                </label>
              </div>
            );
          })}
        </fieldset>

        <div className="field">
          <label htmlFor={fieldId("explanation")}>Penjelasan</label>
          <textarea
            id={fieldId("explanation")}
            rows={2}
            value={draft.explanation}
            onChange={(event) => onEdit({ explanation: event.target.value })}
          />
        </div>

        <figure className="ai-bukti">
          <figcaption>Bukti dari materi</figcaption>
          <blockquote>{draft.source.evidence}</blockquote>
        </figure>
      </fieldset>
    </li>
  );
}

/** Layar review di atas daftar soal: guru mengedit, mencentang, lalu menambahkan. Draf belum tersimpan di mana pun. */
export function AiReview(props: {
  drafts: ReviewDraft[];
  room: number;
  onEdit: (key: string, patch: ReviewEdit) => void;
  onAdd: () => void;
  onDiscard: () => void;
}) {
  const titleId = useId();
  const selected = props.drafts.filter((draft) => draft.selected).length;
  const ungrounded = props.drafts.filter((draft) => !draft.source.grounded).length;
  const note = reviewNote(selected, props.room);
  const noteId = `${titleId}-catatan`;

  return (
    <section className="ai-review" aria-labelledby={titleId}>
      <div className="ai-review-kepala">
        <h2 id={titleId}>Draf dari AI</h2>
        <p className="buku-lead">
          {props.drafts.length} draf. Periksa jawabannya, betulkan kalau perlu, lalu centang yang mau dipakai.
          {ungrounded > 0 && ` ${ungrounded} draf buktinya tidak ditemukan di materi, jadi belum dicentang.`}
        </p>
      </div>
      <ol className="question-list ai-review-daftar">
        {props.drafts.map((draft, index) => (
          <DraftCard key={draft.key} draft={draft} number={index + 1} onEdit={(patch) => props.onEdit(draft.key, patch)} />
        ))}
      </ol>
      <div className="ai-review-aksi">
        <button type="button" className="button button-teks button-teks-bahaya" onClick={props.onDiscard}>
          Buang semua
        </button>
        <button
          type="button"
          className="button button-tinta"
          onClick={props.onAdd}
          disabled={note !== null}
          aria-describedby={note ? noteId : undefined}
        >
          Tambahkan {selected} soal ke kuis
        </button>
        {note && (
          <p id={noteId} className="muted ai-review-catatan">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
