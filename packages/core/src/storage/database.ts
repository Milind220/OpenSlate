/**
 * SQLite database initialization for OpenSlate runtime.
 * Uses Bun's built-in SQLite support.
 */

import Database from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DB_PATH = `${homedir()}/.openslate/data.db`;

/**
 * Initialize the SQLite database with all required tables.
 * Creates the directory and file if they don't exist.
 */
export function initDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'primary',
      status TEXT NOT NULL DEFAULT 'active',
      parent_id TEXT,
      alias TEXT,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES sessions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_parts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      position INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS handoff_states (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'marker',
      compressed_summary TEXT,
      last_compression_index INTEGER NOT NULL DEFAULT 0,
      last_prompt_tokens INTEGER NOT NULL DEFAULT 0,
      marker_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // Indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_message_parts_message ON message_parts(message_id, position)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)");

  return db;
}
