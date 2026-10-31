// Removes only Mondo's hook entries from Claude Code user settings, after a backup.
//   node scripts/uninstall-hooks.mjs [--dry-run] [--settings <path>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupFile, removeMondoHooks } from "./hooks-settings.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const si = args.indexOf("--settings");
const file = si >= 0 ? path.resolve(args[si + 1]) : path.join(os.homedir(), ".claude", "settings.json");

if (!fs.existsSync(file)) {
  console.log(`${file} does not exist. Nothing to remove.`);
  process.exit(0);
}

let current;
try {
  current = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error(`Could not parse ${file}: ${err.message}\nNot touching it.`);
  process.exit(1);
}

const updated = removeMondoHooks(current);
if (JSON.stringify(updated) === JSON.stringify(current)) {
  console.log("No Mondo hooks found. Nothing to remove.");
  process.exit(0);
}

if (dryRun) {
  console.log("Dry run. The \"hooks\" section would become:\n");
  console.log(JSON.stringify(updated.hooks ?? {}, null, 2));
  process.exit(0);
}

const backup = backupFile(file);
fs.writeFileSync(file, JSON.stringify(updated, null, 2) + "\n");
console.log(`Backup written: ${backup}`);
console.log("Removed Mondo's hooks. Other settings and hooks are untouched.");
