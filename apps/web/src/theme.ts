import { useEffect } from "react";

/** "papan" = gelap (HP siswa), "kertas" = terang (guru dan proyektor). Nilainya ada di styles.css. */
export type Theme = "papan" | "kertas";

/**
 * Tema dipasang di <html>, bukan di <main>, supaya latar body ikut berubah: di HP tidak ada strip putih
 * saat halaman ditarik melewati batas (overscroll). Warna status bar Android diambil dari token yang sama.
 */
export function useTheme(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  }, [theme]);
}
