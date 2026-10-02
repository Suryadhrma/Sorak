# @sorak/shared

Kontrak bersama antara web (React), API Worker, GameRoom (Durable Object), dan consumer Queue.
Satu skema Zod dipakai untuk dua hal sekaligus: validasi saat program berjalan dan tipe TypeScript saat kompilasi.

## Isi

| File | Isi |
|---|---|
| `src/constants.ts` | Angka yang harus disepakati semua bagian (batas ukuran, waktu, kuota) |
| `src/primitives.ts` | Potongan kecil: PIN, nickname, nomor soal, mode skor |
| `src/client-messages.ts` | Pesan dari HP pemain dan layar host, plus aturan tahap (`ALLOWED_PHASES`) |
| `src/server-messages.ts` | Pesan dari GameRoom ke HP pemain dan layar host |
| `src/close-codes.ts` | Kode penutupan WebSocket dan `shouldReconnect()` |
| `src/codec.ts` | `decode*` (teks → objek tervalidasi) dan `encode*` (objek → teks) |
| `src/room-storage.ts` | Bentuk storage dan attachment GameRoom, `toPublicQuestion()` |
| `src/events.ts` | Event `game_ended` untuk Queue |

## Perintah

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Contoh pemakaian di GameRoom

```ts
import { decodePlayerMessage, isAllowedInPhase, encodeServerMessage } from "@sorak/shared";

webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
  const result = decodePlayerMessage(raw);
  if (!result.ok) return this.rejectInvalid(ws, result.reason);
  if (!isAllowedInPhase(result.data.t, this.state.phase)) return; // abaikan pesan di luar tahap
  switch (result.data.t) {
    case "answer":
      // TypeScript tahu result.data punya q, choice, elapsedMs, confidence?
      break;
  }
}
```

Paket ini diekspor sebagai source TypeScript (`"exports": "./src/index.ts"`).
Vite dan wrangler (esbuild) membundelnya langsung, jadi tidak perlu langkah build terpisah.
