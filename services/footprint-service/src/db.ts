import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "footprint.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS footprints (
    user_id TEXT PRIMARY KEY,
    case_id TEXT,                       -- process-mining case id for the *latest* assessment
    energy_kwh_month REAL NOT NULL,
    transport_km_week REAL NOT NULL,
    diet_score INTEGER NOT NULL,       -- 1 (plant-based) .. 5 (high red-meat)
    total_co2_kg_year REAL NOT NULL,
    peer_average_co2_kg_year REAL NOT NULL,
    percentile_vs_peers TEXT NOT NULL,
    net_offset_applied_kg REAL NOT NULL DEFAULT 0,  -- cumulative, updated once an offset is certified (BPMN 6.13)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
