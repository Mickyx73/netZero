import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "offsets.db"));
db.pragma("journal_mode = WAL");

// Schema version 2 adds price and the payment token the async worker charges.
// Older demo databases are rebuilt (demo data only).
const SCHEMA_VERSION = 2;
if ((db.pragma("user_version", { simple: true }) as number) < SCHEMA_VERSION) {
  db.exec(`DROP TABLE IF EXISTS offsets`);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS offsets (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,          -- process-mining case id: the originating footprint
                                     -- assessment's caseId when composed (Part C §C.3.2),
                                     -- or this offset's own id when purchased standalone
    user_id TEXT NOT NULL,
    amount_co2_kg REAL NOT NULL,
    project_types TEXT NOT NULL,   -- JSON array, subset of ["reforestation","renewable","waste-recycling"]
    price_aud REAL NOT NULL,
    payment_token TEXT NOT NULL,   -- mock gateway token; never returned by the API
    status TEXT NOT NULL,          -- 'pending' | 'processing' | 'certified' | 'payment_failed'
    certificate_id TEXT,
    retired_serials TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_offsets_user ON offsets (user_id);
`);
