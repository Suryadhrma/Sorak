import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { z } from "zod";
import { RequireHost } from "./RequireHost.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { QuizEditorPage } from "./pages/QuizEditorPage.tsx";
import { QuizListPage } from "./pages/QuizListPage.tsx";
import "./styles.css";

// Pesan validasi lokal tampil di bawah kotak isian, jadi pakai Bahasa Indonesia seperti server.
z.config(z.locales.id());

const root = document.getElementById("root");
if (!root) throw new Error("Elemen #root tidak ditemukan di index.html");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireHost />}>
          <Route path="/quizzes" element={<QuizListPage />} />
          <Route path="/quizzes/new" element={<QuizEditorPage />} />
          <Route path="/quizzes/:id" element={<QuizEditorPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/quizzes" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
