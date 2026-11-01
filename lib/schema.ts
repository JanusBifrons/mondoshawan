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
  // 5: jobs: invisible, scoped background agents (e.g. Regenerate), with full usage for auditing.
  `
  CREATE TABLE jobs (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL,
    project            TEXT,
    title              TEXT NOT NULL,
    input              TEXT NOT NULL DEFAULT '{}',
    model              TEXT,
    effort             TEXT,
    status             TEXT NOT NULL,
    pid                INTEGER,
    session_id         TEXT NOT NULL,
    created_at         INTEGER NOT NULL,
    started_at         INTEGER,
    finished_at        INTEGER,
    duration_ms        INTEGER,
    api_ms             INTEGER,
    turns              INTEGER,
    tool_calls         INTEGER NOT NULL DEFAULT 0,
    cost_usd           REAL,
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    thinking_tokens    INTEGER,
    cache_read_tokens  INTEGER,
    cache_write_tokens INTEGER,
    model_usage        TEXT,
    progress           TEXT,
    summary            TEXT,
    confidence         REAL,
    result             TEXT,
    error              TEXT
  );
  CREATE INDEX jobs_created ON jobs(created_at);
  `,
];

/**
 * Design bible tables. Created idempotently on every open instead of taking a numbered
 * migration, so they never collide with migrations added on other branches.
 * To change one of these tables later, add a numbered migration as usual.
 */
export const DESIGN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS design_nodes (
    id              TEXT PRIMARY KEY,
    project         TEXT NOT NULL,
    parent_id       TEXT REFERENCES design_nodes(id),
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL DEFAULT 'mechanic',
    stage           TEXT NOT NULL,
    fidelity        TEXT NOT NULL DEFAULT 'unchecked',
    checked_sha     TEXT,
    reality_flag    TEXT,
    sort            REAL NOT NULL DEFAULT 0,
    created_by      TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS design_nodes_project ON design_nodes(project, parent_id);

  CREATE TABLE IF NOT EXISTS design_revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT NOT NULL REFERENCES design_nodes(id),
    field       TEXT NOT NULL,
    text        TEXT NOT NULL,
    evidence    TEXT,
    commit_sha  TEXT,
    note        TEXT,
    author      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    signed_at   INTEGER,
    signed_by   TEXT
  );
  CREATE INDEX IF NOT EXISTS design_revisions_node ON design_revisions(node_id, field, id);

  CREATE TABLE IF NOT EXISTS design_reviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id      TEXT NOT NULL REFERENCES design_nodes(id),
    intent_rev   INTEGER,
    reality_rev  INTEGER,
    gap          TEXT NOT NULL,
    reason       TEXT,
    decision     TEXT,
    status       TEXT NOT NULL DEFAULT 'open',
    opened_by    TEXT NOT NULL,
    opened_at    INTEGER NOT NULL,
    closed_by    TEXT,
    closed_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS design_reviews_node ON design_reviews(node_id, status);

  CREATE TABLE IF NOT EXISTS design_questions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id      TEXT NOT NULL REFERENCES design_nodes(id),
    text         TEXT NOT NULL,
    blocking     INTEGER NOT NULL DEFAULT 0,
    related      TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL DEFAULT 'open',
    answer       TEXT,
    raised_by    TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    resolved_by  TEXT,
    resolved_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS design_questions_node ON design_questions(node_id, status);

  CREATE TABLE IF NOT EXISTS design_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     TEXT NOT NULL REFERENCES design_nodes(id),
    to_id       TEXT NOT NULL REFERENCES design_nodes(id),
    type        TEXT NOT NULL,
    note        TEXT,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (from_id, to_id, type)
  );

  CREATE TABLE IF NOT EXISTS design_sources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT NOT NULL REFERENCES design_nodes(id),
    ref         TEXT NOT NULL,
    title       TEXT,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS design_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    project  TEXT NOT NULL,
    node_id  TEXT,
    at       INTEGER NOT NULL,
    actor    TEXT NOT NULL,
    type     TEXT NOT NULL,
    detail   TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS design_events_project ON design_events(project, id);
  CREATE INDEX IF NOT EXISTS design_events_node ON design_events(node_id, id);

  CREATE TABLE IF NOT EXISTS design_chases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT NOT NULL REFERENCES design_nodes(id),
    text        TEXT NOT NULL,
    waiting_on  TEXT NOT NULL DEFAULT 'you',
    due_at      INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    snoozes     INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    closed_by   TEXT,
    closed_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS design_chases_open ON design_chases(status, due_at);
  CREATE INDEX IF NOT EXISTS design_chases_node ON design_chases(node_id, status);

  -- Design talks: a conversation with an agent inside Mondo (lib/design-talk.ts). Each owner
  -- message is one turn, run as a background job that carries on the same Claude session.
  CREATE TABLE IF NOT EXISTS design_talks (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    node_id TEXT,
    question_id INTEGER,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS design_talks_node ON design_talks(node_id);
  CREATE TABLE IF NOT EXISTS design_talk_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    talk_id TEXT NOT NULL,
    text TEXT NOT NULL,
    job_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS design_talk_turns_talk ON design_talk_turns(talk_id, id);
  -- What the owner did with each proposed change (job_id + index into its proposals).
  CREATE TABLE IF NOT EXISTS design_talk_decisions (
    job_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    talk_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    decided_at INTEGER NOT NULL,
    PRIMARY KEY (job_id, idx)
  );
  `;

/**
 * Columns added to design tables after they first shipped. Added idempotently (if missing)
 * on every open, like DESIGN_SCHEMA, so they never need a numbered migration.
 */
export const DESIGN_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: "design_nodes", column: "priority", ddl: "TEXT NOT NULL DEFAULT 'normal'" },
  // The Claude session id of the agent the owner is talking a question through with.
  { table: "design_questions", column: "discussion", ddl: "TEXT" },
  // A turn Mondo sent on the owner's behalf after they decided a card (shown as a small note).
  { table: "design_talk_turns", column: "auto", ddl: "INTEGER NOT NULL DEFAULT 0" },
  // The owner's tweak when they ask for a card to be revised.
  { table: "design_talk_decisions", column: "note", ddl: "TEXT" },
];
