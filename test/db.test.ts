import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/lib/db";
import { MIGRATIONS } from "@/lib/schema";

describe("database", () => {
  it("migrates a fresh database to the latest version", () => {
    const db = openDb(":memory:");
    const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    expect(v).toBe(MIGRATIONS.length);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => !n.startsWith("sqlite_"));
    for (const t of ["sessions", "drive_files", "drive_syncs", "design_nodes", "design_revisions", "design_reviews", "design_events"]) {
      expect(tables).toContain(t);
    }
  });

  it("is safe to migrate twice", () => {
    const db = openDb(":memory:");
    expect(() => migrate(db)).not.toThrow();
  });
});
