import { vi } from "vitest";

type Listener = (event: { data?: unknown; code?: number }) => void;

/** WebSocket palsu untuk test modul koneksi: test yang memutuskan kapan tersambung, pesan datang, atau ditutup. */
export class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  readonly sent: string[] = [];
  closedWith: number | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
  }

  /** Pesan yang dikirim klien, tanpa ping, sudah di-parse. */
  sentMessages(): unknown[] {
    return this.sent.filter((text) => text !== "ping").map((text) => JSON.parse(text));
  }

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  serverSend(message: unknown): void {
    this.emit("message", { data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.emit("close", { code });
  }

  private emit(type: string, event: { data?: unknown; code?: number }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** Pengganti `document`: cukup untuk event visibilitychange; test mengubah visibilityState sendiri. */
export class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
}

/** Memasang WebSocket palsu, location, localStorage di memori, serta window/document untuk event browser. */
export function installBrowserFakes(): {
  latest(): FakeWebSocket;
  storage: Map<string, string>;
  window: EventTarget;
  document: FakeDocument;
} {
  FakeWebSocket.instances = [];
  const storage = new Map<string, string>();
  const window = new EventTarget();
  const document = new FakeDocument();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", { protocol: "https:", host: "sorak.test" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  return {
    latest() {
      const socket = FakeWebSocket.instances.at(-1);
      if (!socket) throw new Error("belum ada WebSocket yang dibuka");
      return socket;
    },
    storage,
    window,
    document,
  };
}
