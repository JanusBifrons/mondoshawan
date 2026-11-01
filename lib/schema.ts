// Phones paired through the LAN gateway. The gateway (scripts/lan-devices.mjs) runs the same SQL
// in case it starts first; test/devices.test.ts checks they match.
export const DEVICES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    name        TEXT NOT NULL,
    code        TEXT NOT NULL,
    status      TEXT NOT NULL,
    ip          TEXT,
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER,
    last_seen   INTEGER
  );
`;

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
  // 2: agents Mondo runs itself (headless `claude`), and their transcripts
  `
  CREATE TABLE agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    project         TEXT NOT NULL,
    cwd             TEXT NOT NULL,
    worktree_name   TEXT,
    model           TEXT,
    permission_mode TEXT NOT NULL,
    session_id      TEXT NOT NULL,
    status          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    last_activity   INTEGER NOT NULL,
    cost_usd        REAL NOT NULL DEFAULT 0,
    exit_info       TEXT
  );

  CREATE TABLE agent_entries (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    at       INTEGER NOT NULL,
    kind     TEXT NOT NULL,
    text     TEXT NOT NULL
  );
  CREATE INDEX agent_entries_agent ON agent_entries(agent_id, id);
  `,
  // 3: phones paired through the LAN gateway
  DEVICES_TABLE_SQL,
  // 4: agents now run as Remote Control sessions in their own Git Bash window.
  //    pid = the claude.exe process (to stop it); agent_entries is no longer written.
  `
  ALTER TABLE agents ADD COLUMN pid INTEGER;
  `,
];
