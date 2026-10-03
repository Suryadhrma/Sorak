import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH, type Host } from "@sorak/shared";
import type { GoogleProfile } from "./google.ts";

export type HostRecord = Host & { sessionVersion: number };

const HostRow = z.object({
  id: z.uuid(),
  email: z.email(),
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  session_version: z.number().int().min(0),
});

function toHostRecord(row: unknown): HostRecord {
  const host = HostRow.parse(row);
  return { id: host.id, email: host.email, displayName: host.display_name, sessionVersion: host.session_version };
}

const HOST_COLUMNS = "id, email, display_name, session_version";

export async function findHostById(db: D1Database, id: string): Promise<HostRecord | null> {
  const row = await db.prepare(`SELECT ${HOST_COLUMNS} FROM hosts WHERE id = ?`).bind(id).first();
  return row ? toHostRecord(row) : null;
}

/** Email sudah dipakai host lain (akun Google lain, atau akun non-Google). Kolom email memakai COLLATE NOCASE. */
export async function isEmailTakenByOtherHost(db: D1Database, profile: GoogleProfile): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM hosts
       WHERE email = ? AND NOT (auth_provider = 'google' AND provider_subject IS ?)`,
    )
    .bind(profile.email, profile.sub)
    .first();
  return row !== null;
}

export async function upsertGoogleHost(db: D1Database, profile: GoogleProfile, now: number): Promise<HostRecord> {
  // Dipotong per code point, sama dengan cara SQLite length() menghitung untuk CHECK display_name.
  const displayName = Array.from(profile.name).slice(0, DISPLAY_NAME_MAX_LENGTH).join("");
  const row = await db
    .prepare(
      `INSERT INTO hosts (id, email, display_name, auth_provider, provider_subject, created_at, updated_at)
       VALUES (?, ?, ?, 'google', ?, ?, ?)
       ON CONFLICT (auth_provider, provider_subject) WHERE provider_subject IS NOT NULL
       DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
       RETURNING ${HOST_COLUMNS}`,
    )
    .bind(crypto.randomUUID(), profile.email, displayName, profile.sub, now, now)
    .first();
  return toHostRecord(row);
}
