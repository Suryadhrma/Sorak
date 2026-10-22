import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { describeError, logout } from "./api.ts";
import { Logo } from "./Logo.tsx";
import { useHost } from "./RequireHost.tsx";

/** Kepala halaman guru (board Guru-2): logo, tautan Kuis saya dan Riwayat, nama guru, dan Keluar. */
export function TeacherHeader() {
  const host = useHost();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout() {
    setLogoutError(null);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(describeError(error));
    }
  }

  return (
    <header className="buku-header">
      <Link to="/quizzes" className="buku-header-logo" aria-label="Sorak, ke Kuis saya">
        <Logo />
      </Link>
      <nav className="buku-nav" aria-label="Halaman guru">
        <NavLink to="/quizzes" end>
          Kuis saya
        </NavLink>
        <NavLink to="/games">Riwayat</NavLink>
      </nav>
      <div className="buku-akun">
        <span className="buku-nama">
          {host.displayName}
          <span className="buku-avatar" aria-hidden="true">
            {host.displayName.charAt(0).toUpperCase()}
          </span>
        </span>
        <button type="button" className="button button-teks" onClick={handleLogout}>
          Keluar
        </button>
      </div>
      {logoutError && (
        <p className="alert buku-header-alert" role="alert">
          {logoutError}
        </p>
      )}
    </header>
  );
}
