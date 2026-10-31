// Registers Mondo's hook in Claude Code user settings (~/.claude/settings.json).
//   node scripts/install-hooks.mjs            dry run: shows exactly what would change
//   node scripts/install-hooks.mjs --apply    backs up the file, then merges
//   --settings <path>                          use a different settings file (for testing)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addMondoHooks, hookCommand, mondoEntries, timestamp } from "./hooks-settings.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const si = args.indexOf("--settings");
const file = si >= 0 ? path.resolve(args[si + 1]) : path.join(os.homedir(), ".claude", "settings.json");

let current = {};
const exists = fs.existsSync(file);
if (exists) {
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Could not parse ${file}: ${err.message}\nNot touching it.`);
    process.exit(1);
  }
}

const updated = addMondoHooks(current);
const unchanged = JSON.stringify(updated) === JSON.stringify(current);

console.log(`Settings file: ${file}${exists ? "" : " (will be created)"}`);
console.log(`Hook command:  ${hookCommand()}\n`);
console.log("Mondo will add these entries under \"hooks\" (appended after any existing hooks for each event):\n");
console.log(JSON.stringify(mondoEntries(), null, 2));
console.log("\nEverything else in the file is kept as-is. Any earlier Mondo entries are replaced, not duplicated.");

if (unchanged) {
  console.log("\nMondo's hooks are already installed. Nothing to do.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run: nothing changed. Re-run with --apply to install.");
  process.exit(0);
}

if (exists) {
  const backup = `${file}.bak-${timestamp()}`;
  fs.copyFileSync(file, backup);
  console.log(`\nBackup written: ${backup}`);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(updated, null, 2) + "\n");
console.log(`Installed. New Claude Code sessions will report to Mondo (already-open sessions won't).`);
