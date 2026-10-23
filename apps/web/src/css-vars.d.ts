import "react";

// Variabel CSS yang dipasang lewat style inline. --urutan = urutan masuk sebuah elemen (jeda animasi dihitung di CSS);
// --lajur = posisi mendatar label sorak di proyektor.
declare module "react" {
  interface CSSProperties {
    "--urutan"?: number;
    "--lajur"?: number;
  }
}
