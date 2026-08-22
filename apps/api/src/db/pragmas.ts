import type { Database } from "bun:sqlite";

export function applyPragmas(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
}
