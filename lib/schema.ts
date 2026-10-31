/**
 * Ordered schema migrations. Each entry runs once, tracked by `PRAGMA user_version`
 * (entry i brings the database to version i + 1). Append only: never edit or
 * reorder an entry that has shipped; add a new one instead.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: sessions (moved from data/state.json) + Google Drive mirror
  `
  CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    cwd             TEXT NOT NULL,
    project         TEXT,
    worktree        TEXT NOT NULL,
    branch          TEXT,
    status          TEXT NOT NULL,
    status_at       INTEGER NOT NULL,
    started_at      INTEGER NOT NULL,
    last_activity   INTEGER NOT NULL,
    last_event      TEXT NOT NULL,
    last_message    TEXT,
    transcript_path TEXT,
    system          TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE drive_files (
    id            TEXT PRIMARY KEY,
    project       TEXT NOT NULL,
    title         TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    url           TEXT NOT NULL,
    folder_path   TEXT NOT NULL DEFAULT '',
    modified_time TEXT,
    content       TEXT,
    synced_at     INTEGER NOT NULL,
    removed_at    INTEGER
  );
  CREATE INDEX drive_files_project ON drive_files(project, removed_at);

  CREATE TABLE drive_syncs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project       TEXT NOT NULL,
    folder_id     TEXT,
    started_at    INTEGER NOT NULL,
    finished_at   INTEGER,
    files_seen    INTEGER NOT NULL DEFAULT 0,
    files_changed INTEGER NOT NULL DEFAULT 0,
    files_removed INTEGER NOT NULL DEFAULT 0,
    error         TEXT
  );
  CREATE INDEX drive_syncs_project ON drive_syncs(project, started_at);
  `,
];
