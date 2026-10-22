import { Link, useSearchParams } from "react-router";
import { Logo } from "../Logo.tsx";
import { FlapDigits } from "../motion/FlapDigits.tsx";
import { Tally } from "../motion/Tally.tsx";
import { useTheme } from "../theme.ts";

const LOGIN_ERRORS: Record<string, string> = {
  google_failed: "Masuk dengan Google gagal. Silakan coba lagi.",
  email_taken: "Email ini sudah terdaftar di akun Sorak lain.",
};

/** Contoh isi layar depan kelas di panel hiasan Guru-1; bukan data siapa pun. */
const SAMPLE_SCOREBOARD = [
  { rank: 1, nickname: "Dimas", score: "3.540" },
  { rank: 2, nickname: "Rara", score: "3.210" },
  { rank: 3, nickname: "Nayla", score: "3.100" },
];

/** Guru-1: masuk dengan Google, dengan panel contoh layar depan kelas di layar lebar. */
export function LoginPage() {
  useTheme("kertas");
  const [params] = useSearchParams();
  const errorKey = params.get("error");
  const error = errorKey ? (LOGIN_ERRORS[errorKey] ?? LOGIN_ERRORS.google_failed) : null;

  return (
    <div className="buku">
      <main className="buku-isi login">
        <div className="login-isi">
          <Logo animate />
          <h1 className="login-judul">Buat kuis, lalu main bareng satu kelas.</h1>
          <p className="buku-lead">
            Siswa ikut dari HP masing-masing cukup dengan PIN. Tidak perlu akun dan tidak perlu memasang aplikasi.
          </p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div>
            {/* Navigasi biasa, bukan fetch: alur OAuth butuh redirect penuh ke halaman Google. */}
            <a className="button button-besar" href="/api/auth/google/start">
              Masuk dengan Google
            </a>
            <p className="muted login-catatan">Sorak hanya memakai nama dan email akun Google kamu.</p>
          </div>
          <p className="muted login-siswa">
            Kamu siswa? Buka Sorak di HP dan <Link to="/">masukkan PIN dari guru</Link>.
          </p>
        </div>

        {/* Hiasan: gambaran layar proyektor saat game berjalan. Disembunyikan dari pembaca layar. */}
        <div className="login-papan" aria-hidden="true">
          <p className="login-papan-label">Layar depan kelas</p>
          <p className="login-papan-pin">
            <FlapDigits value="408" />
            <FlapDigits value="213" delayOffset={3} />
          </p>
          <p className="login-papan-hitung">
            <Tally count={12} label="12 siswa" />
            12 siswa masuk
          </p>
          <ol className="login-papan-skor">
            {SAMPLE_SCOREBOARD.map((row) => (
              <li key={row.rank}>
                <span className="login-papan-peringkat">{row.rank}</span>
                <span className="login-papan-baris">
                  <span>{row.nickname}</span>
                  <span className="login-papan-poin">{row.score}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </main>
    </div>
  );
}
