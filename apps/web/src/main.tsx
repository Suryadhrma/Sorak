import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type Health = { kind: "loading" } | { kind: "ok" } | { kind: "error"; detail: string };

function HealthStatus() {
  const [health, setHealth] = useState<Health>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((res) => setHealth(res.ok ? { kind: "ok" } : { kind: "error", detail: `HTTP ${res.status}` }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ kind: "error", detail: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, []);

  if (health.kind === "loading") return <p role="status">Memeriksa API…</p>;
  if (health.kind === "ok") return <p role="status">API sehat.</p>;
  return <p role="alert">API tidak bisa dihubungi ({health.detail}).</p>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Elemen #root tidak ditemukan di index.html");

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Sorak</h1>
      <HealthStatus />
    </main>
  </StrictMode>,
);
