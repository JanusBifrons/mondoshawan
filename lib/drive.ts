import { tx, type DB } from "./db";

/**
 * Google Drive mirror. Mondo can't reach Drive itself; a Claude session reads each
 * project's Drive folder through the Google Drive connector (see
 * .claude/skills/drive-sync) and hands the result to `importDrive` via
 * `npm run drive:import`. Mondo then serves those rows from SQLite.
 */

export interface DriveFileInput {
  id: string;
  title: string;
  mimeType: string;
  url: string;
  /** Path inside the project's Drive folder, e.g. "Plans" ("" for the top level). */
  folderPath?: string;
  modifiedTime?: string | null;
  /** Document text. Omit to keep what's already stored (unchanged since last sync). */
  content?: string | null;
}

export interface DriveImportPayload {
  project: string;
  folderId?: string | null;
  /** True when `files` is the folder's full listing, so anything missing was removed. */
  complete?: boolean;
  files?: DriveFileInput[];
  /** Set instead of files when the sync failed; recorded so Settings can show it. */
  error?: string;
}

export interface DriveImportResult {
  syncId: number;
  seen: number;
  added: number;
  updated: number;
  removed: number;
}

export interface DriveFile {
  id: string;
  project: string;
  title: string;
  mimeType: string;
  url: string;
  folderPath: string;
  modifiedTime: string | null;
  content: string | null;
  syncedAt: number;
}

export interface DriveSync {
  project: string;
  folderId: string | null;
  startedAt: number;
  finishedAt: number | null;
  filesSeen: number;
  filesChanged: number;
  filesRemoved: number;
  error: string | null;
}

export function importDrive(db: DB, p: DriveImportPayload, now = Date.now()): DriveImportResult {
  if (!p?.project) throw new Error("payload.project is required");
  const files = p.files ?? [];
  for (const f of files) {
    if (!f.id || !f.title || !f.mimeType || !f.url) throw new Error(`file is missing id/title/mimeType/url: ${JSON.stringify(f)}`);
  }

  return tx(db, () => {
    const syncId = Number(
      db
        .prepare("INSERT INTO drive_syncs (project, folder_id, started_at, error) VALUES (?, ?, ?, ?)")
        .run(p.project, p.folderId ?? null, now, p.error ?? null).lastInsertRowid,
    );
    let added = 0;
    let updated = 0;
    let removed = 0;

    if (!p.error) {
      const find = db.prepare(
        "SELECT title, mime_type, folder_path, modified_time, content, removed_at, project FROM drive_files WHERE id = ?",
      );
      const upsert = db.prepare(`
        INSERT INTO drive_files (id, project, title, mime_type, url, folder_path, modified_time, content, synced_at, removed_at)
        VALUES (:id, :project, :title, :mimeType, :url, :folderPath, :modifiedTime, :content, :now, NULL)
        ON CONFLICT(id) DO UPDATE SET
          project = excluded.project, title = excluded.title, mime_type = excluded.mime_type,
          url = excluded.url, folder_path = excluded.folder_path, modified_time = excluded.modified_time,
          content = COALESCE(excluded.content, drive_files.content),
          synced_at = excluded.synced_at, removed_at = NULL`);

      for (const f of files) {
        const prev = find.get(f.id) as
          | { title: string; mime_type: string; folder_path: string; modified_time: string | null; content: string | null; removed_at: number | null; project: string }
          | undefined;
        const row = {
          id: f.id,
          project: p.project,
          title: f.title,
          mimeType: f.mimeType,
          url: f.url,
          folderPath: f.folderPath ?? "",
          modifiedTime: f.modifiedTime ?? null,
          content: f.content ?? null,
          now,
        };
        if (!prev || prev.removed_at !== null) added++;
        else if (
          prev.title !== row.title ||
          prev.folder_path !== row.folderPath ||
          prev.modified_time !== row.modifiedTime ||
          prev.project !== row.project ||
          (row.content !== null && row.content !== prev.content)
        )
          updated++;
        upsert.run(row);
      }

      if (p.complete) {
        const seen = new Set(files.map((f) => f.id));
        const live = db
          .prepare("SELECT id FROM drive_files WHERE project = ? AND removed_at IS NULL")
          .all(p.project) as { id: string }[];
        const mark = db.prepare("UPDATE drive_files SET removed_at = ? WHERE id = ?");
        for (const { id } of live) {
          if (!seen.has(id)) {
            mark.run(now, id);
            removed++;
          }
        }
      }
    }

    db.prepare(
      "UPDATE drive_syncs SET finished_at = ?, files_seen = ?, files_changed = ?, files_removed = ? WHERE id = ?",
    ).run(now, files.length, added + updated, removed, syncId);
    return { syncId, seen: files.length, added, updated, removed };
  });
}

interface FileRow {
  id: string;
  project: string;
  title: string;
  mime_type: string;
  url: string;
  folder_path: string;
  modified_time: string | null;
  content: string | null;
  synced_at: number;
}

const toFile = (r: FileRow): DriveFile => ({
  id: r.id,
  project: r.project,
  title: r.title,
  mimeType: r.mime_type,
  url: r.url,
  folderPath: r.folder_path,
  modifiedTime: r.modified_time,
  content: r.content,
  syncedAt: r.synced_at,
});

/** Current (not removed) Drive files for a project. */
export function listDriveFiles(db: DB, project: string): DriveFile[] {
  return (
    db
      .prepare("SELECT * FROM drive_files WHERE project = ? AND removed_at IS NULL ORDER BY folder_path, title")
      .all(project) as unknown as FileRow[]
  ).map(toFile);
}

export function getDriveFile(db: DB, id: string): DriveFile | null {
  const r = db.prepare("SELECT * FROM drive_files WHERE id = ? AND removed_at IS NULL").get(id) as FileRow | undefined;
  return r ? toFile(r) : null;
}

export function lastDriveSync(db: DB, project: string): DriveSync | null {
  const r = db
    .prepare("SELECT * FROM drive_syncs WHERE project = ? ORDER BY started_at DESC, id DESC LIMIT 1")
    .get(project) as
    | { project: string; folder_id: string | null; started_at: number; finished_at: number | null; files_seen: number; files_changed: number; files_removed: number; error: string | null }
    | undefined;
  return r
    ? {
        project: r.project,
        folderId: r.folder_id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        filesSeen: r.files_seen,
        filesChanged: r.files_changed,
        filesRemoved: r.files_removed,
        error: r.error,
      }
    : null;
}
