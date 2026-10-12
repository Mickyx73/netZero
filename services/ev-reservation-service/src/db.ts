import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "reservations.db"));
db.pragma("journal_mode = WAL");

// Schema version 2 adds the charging-session lifecycle (pre-authorisation
// hold, session start) and replaces the old UNIQUE(station_id, slot_start)
// constraint with an overlap check (see index.ts). Older demo databases are
// simply rebuilt -- they only ever hold demo data.
const SCHEMA_VERSION = 2;
if ((db.pragma("user_version", { simple: true }) as number) < SCHEMA_VERSION) {
  db.exec(`DROP TABLE IF EXISTS reservations`);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,                -- also the process-mining case id
    station_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    slot_start TEXT NOT NULL,           -- normalised ISO-8601 UTC, so string comparison == time comparison
    slot_end TEXT NOT NULL,
    -- confirmed -> charging -> session_ended            (happy path)
    -- confirmed -> preauth_declined -> charging          (BPMN 4.7a retry loop)
    -- preauth_declined -> abandoned / confirmed -> expired (observed deviations)
    status TEXT NOT NULL DEFAULT 'confirmed',
    confirmation_code TEXT NOT NULL,
    preauth_attempts INTEGER NOT NULL DEFAULT 0,
    hold_id TEXT,
    hold_amount REAL,
    session_started_at TEXT,
    kwh_consumed REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reservations_station_slot ON reservations (station_id, slot_start, slot_end);
  CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations (user_id);
`);

/** Statuses that still occupy the bay for their time slot. */
export const OCCUPYING_STATUSES = ["confirmed", "preauth_declined", "charging", "session_ended"];
