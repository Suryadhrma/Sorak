import { useSearchParams } from "react-router";
import { Logo } from "../Logo.tsx";
import { useTheme } from "../theme.ts";

const LOGIN_ERRORS: Record<string, string> = {
  google_failed: "Masuk dengan Google gagal. Silakan coba lagi.",
  email_taken: "Email ini sudah terdaftar di akun Sorak lain.",
};

export function LoginPage() {
  useTheme("kertas");
  const [params] = useSearchParams();
  const errorKey = params.get("error");
  const error = errorKey ? (LOGIN_ERRORS[errorKey] ?? LOGIN_ERRORS.google_failed) : null;

  return (
    <main className="page page-narrow">
      <h1>
        <Logo />
      </h1>
      <p>Masuk untuk membuat dan mengelola kuis.</p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {/* Navigasi biasa, bukan fetch: alur OAuth butuh redirect penuh ke halaman Google. */}
      <a className="button button-primary" href="/api/auth/google/start">
        Masuk dengan Google
      </a>
    </main>
  );
}
