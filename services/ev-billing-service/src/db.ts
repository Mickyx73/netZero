import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "billing.db"));
db.pragma("journal_mode = WAL");

// Schema version 2 records the pre-authorisation hold that settlement captures
// against. Older demo databases are rebuilt (demo data only).
const SCHEMA_VERSION = 2;
if ((db.pragma("user_version", { simple: true }) as number) < SCHEMA_VERSION) {
  db.exec(`DROP TABLE IF EXISTS bills`);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS bills (
    session_id TEXT PRIMARY KEY,     -- == reservation id == process-mining case id
    user_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    kwh REAL NOT NULL,
    session_seconds INTEGER,
    tariff_per_kwh REAL NOT NULL,
    cost REAL NOT NULL,
    hold_id TEXT,
    hold_amount REAL,
    released_amount REAL,
    transaction_id TEXT,
    status TEXT NOT NULL,            -- 'settling' | 'settled'
    receipt_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bills_user ON bills (user_id);
`);
