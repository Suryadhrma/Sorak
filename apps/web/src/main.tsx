import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { z } from "zod";
import { RequireHost } from "./RequireHost.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { PlayPage } from "./pages/PlayPage.tsx";
import "./styles.css";

// Halaman guru dipisah ke file JS sendiri (code splitting): HP siswa hanya mengunduh halaman PIN dan lobby.
const LoginPage = lazy(() => import("./pages/LoginPage.tsx").then((module) => ({ default: module.LoginPage })));
const QuizListPage = lazy(() => import("./pages/QuizListPage.tsx").then((module) => ({ default: module.QuizListPage })));
const QuizEditorPage = lazy(() =>
  import("./pages/QuizEditorPage.tsx").then((module) => ({ default: module.QuizEditorPage })),
);
const HostPage = lazy(() => import("./pages/HostPage.tsx").then((module) => ({ default: module.HostPage })));

// Pesan validasi lokal tampil di bawah kotak isian, jadi pakai Bahasa Indonesia seperti server.
z.config(z.locales.id());

const root = document.getElementById("root");
if (!root) throw new Error("Elemen #root tidak ditemukan di index.html");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense
        fallback={
          <p className="page-status" role="status">
            Memuat…
          </p>
        }
      >
        <Routes>
          <Route path="/" element={<JoinPage />} />
          <Route path="/play/:pin" element={<PlayPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireHost />}>
            <Route path="/quizzes" element={<QuizListPage />} />
            <Route path="/quizzes/new" element={<QuizEditorPage />} />
            <Route path="/quizzes/:id" element={<QuizEditorPage />} />
            <Route path="/host/:pin" element={<HostPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
