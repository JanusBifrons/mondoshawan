import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { dataDir } from "./config";
import { DESIGN_SCHEMA, MIGRATIONS } from "./schema";

/**
 * Mondo's local database: SQLite via Node's built-in `node:sqlite` (no native module,
 * so Electron packaging stays simple). Same approach as eqx-net's src/server/db/Database.ts.
 * WAL mode lets the Drive import CLI write while the server is running.
 */

// Loaded at runtime via getBuiltinModule so Next's bundler never tries to resolve it
// (a static import or createRequire breaks `next build`).
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type DB = DatabaseSyncType;

export function dbPath(): string {
  return process.env.MONDO_DB || path.join(dataDir(), "mondo.db");
}

/** Bring a connection's schema up to date. Safe to call repeatedly. */
export function migrate(db: DB): number {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`[mondo] migration ${v + 1} failed: ${(err as Error).message}`);
    }
  }
  db.exec(DESIGN_SCHEMA);
  return MIGRATIONS.length;
}

/** Open (and migrate) a database. Pass ":memory:" in tests. */
export function openDb(file = dbPath()): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  migrate(db);
  return db;
}

const g = globalThis as unknown as { __mondoDb?: DB };

/** Shared connection for the server (lazy, survives dev reloads). */
export function getDb(): DB {
  return (g.__mondoDb ??= openDb());
}

/** Run `fn` inside a transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
