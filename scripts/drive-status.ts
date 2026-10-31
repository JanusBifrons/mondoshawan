// Prints, as JSON, what the drive-sync skill needs: each project's Drive folder
// and the files Mondo already has (id + modifiedTime), so only changed docs are re-read.
//   npm run drive:status
import { loadConfig } from "../lib/config";
import { openDb } from "../lib/db";
import { lastDriveSync, listDriveFiles } from "../lib/drive";

function main() {
  const db = openDb();
  const out = loadConfig().projects.map((p) => {
    const drive = p.knowledge?.drive ?? null;
    const last = lastDriveSync(db, p.name);
    return {
      project: p.name,
      folder: drive?.folder ?? null,
      folderId: drive?.folderId ?? last?.folderId ?? null,
      lastSync: last ? new Date(last.startedAt).toISOString() : null,
      lastError: last?.error ?? null,
      known: listDriveFiles(db, p.name).map((f) => ({
        id: f.id,
        title: f.title,
        modifiedTime: f.modifiedTime,
        hasContent: f.content !== null,
      })),
    };
  });
  db.close();
  console.log(JSON.stringify(out, null, 2));
}

main();
