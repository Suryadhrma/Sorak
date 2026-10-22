import { useEffect, useState } from "react";
import { Link } from "react-router";
import { type GameSummary } from "@sorak/shared";
import { describeError, listGames } from "../api.ts";
import { rowOrder } from "../motion/row-order.ts";
import { SCORING_MODES } from "../scoring-modes.ts";
import { TeacherHeader } from "../TeacherHeader.tsx";
import { useTheme } from "../theme.ts";

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; games: GameSummary[]; nextCursor: string | null; loadingMore: boolean; moreError: string | null }
  | { kind: "error"; message: string };

const endedAtFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

/** Riwayat: game yang sudah selesai, terbaru dulu, dengan keyset pagination ("Muat lebih banyak"). */
export function GamesPage() {
  useTheme("kertas");
  const [state, setState] = useState<ListState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    listGames(null)
      .then((page) => {
        if (active) setState({ kind: "ready", games: page.games, nextCursor: page.nextCursor, loadingMore: false, moreError: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: "error", message: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadMore(cursor: string) {
    setState((current) => (current.kind === "ready" ? { ...current, loadingMore: true, moreError: null } : current));
    try {
      const page = await listGames(cursor);
      setState((current) =>
        current.kind === "ready"
          ? { kind: "ready", games: [...current.games, ...page.games], nextCursor: page.nextCursor, loadingMore: false, moreError: null }
          : current,
      );
    } catch (error) {
      setState((current) => (current.kind === "ready" ? { ...current, loadingMore: false, moreError: describeError(error) } : current));
    }
  }

  return (
    <div className="buku">
      <TeacherHeader />
      <main className="buku-isi">
        <h1>Riwayat</h1>

        {state.kind === "loading" && (
          <p className="page-status" role="status">
            Memuat riwayat…
          </p>
        )}
        {state.kind === "error" && (
          <p className="alert" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && state.games.length === 0 && (
          <p className="empty">Belum ada game yang selesai. Hasil game muncul di sini setelah kamu menekan Selesai di podium.</p>
        )}
        {state.kind === "ready" && state.games.length > 0 && (
          <>
            <ul className="buku-daftar">
              {state.games.map((game, index) => (
                <li key={game.id} className="buku-baris" style={{ "--urutan": rowOrder(index) }}>
                  <div className="buku-baris-isi">
                    <Link className="buku-baris-judul" to={`/games/${game.id}`}>
                      {game.quizTitle}
                    </Link>
                    <p className="muted">
                      {endedAtFormat.format(game.endedAt)} · {game.playerCount} pemain · {game.questionCount} soal · Mode{" "}
                      {SCORING_MODES[game.scoringMode].name}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {state.moreError && (
              <p className="alert" role="alert">
                {state.moreError}
              </p>
            )}
            {state.nextCursor && (
              <button
                type="button"
                className="button"
                disabled={state.loadingMore}
                onClick={() => state.nextCursor && loadMore(state.nextCursor)}
              >
                {state.loadingMore ? "Memuat…" : "Muat lebih banyak"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
