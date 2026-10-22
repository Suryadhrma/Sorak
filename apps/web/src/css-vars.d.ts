import "react";

// Variabel CSS yang dipasang lewat style inline. --urutan = urutan masuk sebuah elemen (jeda animasi dihitung di CSS).
declare module "react" {
  interface CSSProperties {
    "--urutan"?: number;
  }
}
