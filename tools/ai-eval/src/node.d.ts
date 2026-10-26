// Deklarasi minimal API Node yang dipakai skrip ini, supaya tidak perlu dependensi baru (@types/node).
// Kalau @types/node kelak dipasang, hapus file ini.

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode: number | undefined;
};

declare module "node:fs/promises" {
  export function readFile(path: URL, encoding: "utf8"): Promise<string>;
  export function writeFile(path: URL, data: string): Promise<void>;
  export function readdir(path: URL): Promise<string[]>;
  export function mkdir(path: URL, options: { recursive: true }): Promise<string | undefined>;
}
