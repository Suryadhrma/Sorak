const SESSION_TOKEN_BYTES = 16;

/** Token sesi pemain: 16 byte acak dalam base64url tanpa padding (22 karakter, sesuai SessionToken). */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Yang disimpan hanya SHA-256 hex dari token, supaya isi attachment tidak bisa dipakai untuk resume. */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
