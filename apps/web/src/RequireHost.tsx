import { useEffect, useState } from "react";
import { Outlet, useNavigate, useOutletContext } from "react-router";
import type { Host } from "@sorak/shared";
import { ApiRequestError, describeError, getMe } from "./api.ts";

type HostState = { kind: "loading" } | { kind: "ready"; host: Host } | { kind: "error"; message: string };

/** Gerbang untuk semua halaman selain /login: tanya /api/me dulu, belum login dipindah ke /login. */
export function RequireHost() {
  const navigate = useNavigate();
  const [state, setState] = useState<HostState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    getMe()
      .then((host) => {
        if (active) setState({ kind: "ready", host });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiRequestError && error.code === "UNAUTHENTICATED") {
          navigate("/login", { replace: true });
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (state.kind === "loading") return <p className="page-status" role="status">Memuat…</p>;
  if (state.kind === "error") return <p className="page-status" role="alert">{state.message}</p>;
  return <Outlet context={state.host} />;
}

export function useHost(): Host {
  return useOutletContext<Host>();
}
