const LETTERS = ["A", "B", "C", "D"] as const;

export function answerLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/** Kelas grid pilihan: soal 2 pilihan satu kolom, selain itu 2×2. */
export function answersClass(count: number): string {
  return count === 2 ? "answers answers-2" : "answers";
}

/**
 * Kartu regu: warna seragam per huruf (token --kartu-a..d), huruf besar di kiri atas, teks di kiri bawah.
 * Hurufnya yang membedakan pilihan, jadi pilihan tetap bisa dibedakan tanpa melihat warna.
 */
function CardContent({ index, text }: { index: number; text: string }) {
  return (
    <>
      <span className="answer-letter" aria-hidden="true">
        {answerLetter(index)}
      </span>
      <span className="answer-text">{text}</span>
    </>
  );
}

/** Tombol jawaban di HP siswa. aria-label berisi huruf dan isi pilihan. */
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
      <CardContent index={props.index} text={props.text} />
    </button>
  );
}

/** Kartu pilihan di layar proyektor (tidak bisa ditekan). Saat reveal: jawaban benar bercincin, sisanya redup. */
export function AnswerRow(props: { index: number; text: string; correct?: boolean; dimmed?: boolean }) {
  const classes = ["answer", `answer-${props.index}`];
  if (props.correct) classes.push("answer-correct");
  if (props.dimmed) classes.push("answer-dimmed");
  return (
    <li className={classes.join(" ")} aria-label={`Pilihan ${answerLetter(props.index)}: ${props.text}${props.correct ? " (jawaban benar)" : ""}`}>
      <CardContent index={props.index} text={props.text} />
    </li>
  );
}

/** Ubin huruf kecil berwarna kartu, untuk daftar sebaran jawaban. */
export function AnswerTile({ index }: { index: number }) {
  return (
    <span className={`answer-tile answer-${index}`} aria-hidden="true">
      <span className="answer-letter">{answerLetter(index)}</span>
    </span>
  );
}
