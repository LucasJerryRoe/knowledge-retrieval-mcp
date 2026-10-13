import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_document (
  knowledge_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS retrieval_query (
  query_id TEXT PRIMARY KEY,
  session_id TEXT,
  query_text TEXT NOT NULL,
  top_k INTEGER NOT NULL,
  retrieval_strategy TEXT NOT NULL,
  index_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CRASHED')),
  candidate_count INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS retrieval_candidate (
  candidate_id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES retrieval_query(query_id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_document(knowledge_id),
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  retrieval_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_read (
  read_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES retrieval_candidate(candidate_id),
  query_id TEXT NOT NULL REFERENCES retrieval_query(query_id),
  knowledge_id TEXT NOT NULL REFERENCES knowledge_document(knowledge_id),
  read_snapshot_hash TEXT NOT NULL,
  version_changed INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_session ON retrieval_query(session_id);
CREATE INDEX IF NOT EXISTS idx_candidate_query ON retrieval_candidate(query_id);
CREATE INDEX IF NOT EXISTS idx_read_candidate ON knowledge_read(candidate_id);
`;

export type SqliteDatabase = Database.Database;

export function openDatabase(databasePath: string): SqliteDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(SCHEMA);
  return database;
}
