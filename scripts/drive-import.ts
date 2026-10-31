// Imports one Drive sync payload (JSON file) into Mondo's database.
//   npm run drive:import -- <payload.json> [more.json ...]
// Writes straight to data/mondo.db, so Mondo doesn't need to be running.
// Payload shape: see DriveImportPayload in lib/drive.ts.
import fs from "node:fs";
import { loadConfig } from "../lib/config";
import { openDb } from "../lib/db";
import { importDrive, type DriveImportPayload } from "../lib/drive";

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: npm run drive:import -- <payload.json> [...]");
    process.exit(2);
  }
  const projects = new Set(loadConfig().projects.map((p) => p.name));
  const db = openDb();
  let failed = false;
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const payloads: DriveImportPayload[] = Array.isArray(raw) ? raw : [raw];
      for (const p of payloads) {
        if (!projects.has(p.project)) throw new Error(`unknown project "${p.project}" (not in mondo.config.json)`);
        const r = importDrive(db, p);
        console.log(
          p.error
            ? `${p.project}: recorded failed sync: ${p.error}`
            : `${p.project}: ${r.seen} files, ${r.added} new, ${r.updated} updated, ${r.removed} removed`,
        );
      }
    } catch (err) {
      failed = true;
      console.error(`${file}: ${(err as Error).message}`);
    }
  }
  db.close();
  process.exit(failed ? 1 : 0);
}

main();
