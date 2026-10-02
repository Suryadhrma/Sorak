import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port bawaan `wrangler dev` (pnpm dev di root).
const WORKER_ORIGIN = "localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://${WORKER_ORIGIN}`,
      "/ws": { target: `ws://${WORKER_ORIGIN}`, ws: true },
    },
  },
});
