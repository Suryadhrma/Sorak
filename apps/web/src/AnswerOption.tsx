import type { ReactNode } from "react";

const LETTERS = ["A", "B", "C", "D"] as const;

export function answerLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/**
 * Tanda pilihan jawaban: bentuk + huruf, dengan warna dari token --answer-N.
 * Bentuk dan huruf membuat pilihan tetap bisa dibedakan oleh siswa buta warna.
 */
function AnswerMark({ index }: { index: number }) {
  return (
    <span className="answer-mark" aria-hidden="true">
      <span className={`answer-shape answer-shape-${index}`} />
      <span className="answer-letter">{answerLetter(index)}</span>
    </span>
  );
}

/** Tombol jawaban di HP siswa. aria-label berisi isi pilihan, supaya pembaca layar tidak hanya membaca bentuknya. */
export function AnswerButton(props: {
  index: number;
  text: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`answer answer-${props.index}${props.selected ? " answer-selected" : ""}`}
      aria-label={`Pilihan ${answerLetter(props.index)}: ${props.text}`}
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      <AnswerMark index={props.index} />
      <span className="answer-text">{props.text}</span>
    </button>
  );
}

/** Pilihan jawaban di layar proyektor (tidak bisa ditekan). `children` untuk batang sebaran saat reveal. */
export function AnswerRow(props: { index: number; text: string; correct?: boolean; dimmed?: boolean; children?: ReactNode }) {
  const classes = ["answer", `answer-${props.index}`, "answer-static"];
  if (props.correct) classes.push("answer-correct");
  if (props.dimmed) classes.push("answer-dimmed");
  return (
    <li className={classes.join(" ")}>
      <AnswerMark index={props.index} />
      <span className="answer-text">
        {props.text}
        {props.correct && <span className="visually-hidden"> (jawaban benar)</span>}
      </span>
      {props.children}
    </li>
  );
}
