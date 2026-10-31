import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { getDriveFile, importDrive, lastDriveSync, listDriveFiles } from "@/lib/drive";

const doc = (id: string, extra = {}) => ({
  id,
  title: `Doc ${id}`,
  mimeType: "application/vnd.google-apps.document",
  url: `https://docs.google.com/document/d/${id}/edit`,
  modifiedTime: "2026-06-01T00:00:00Z",
  content: `# Doc ${id}\n\nBody`,
  ...extra,
});

describe("importDrive", () => {
  it("adds files and records the sync", () => {
    const db = openDb(":memory:");
    const r = importDrive(db, { project: "EQX-Net", folderId: "F", complete: true, files: [doc("a"), doc("b")] }, 1000);
    expect(r).toMatchObject({ seen: 2, added: 2, updated: 0, removed: 0 });
    expect(listDriveFiles(db, "EQX-Net").map((f) => f.id)).toEqual(["a", "b"]);
    expect(lastDriveSync(db, "EQX-Net")).toMatchObject({ folderId: "F", filesSeen: 2, filesChanged: 2, error: null });
  });

  it("keeps stored content when a file is sent without it", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", files: [doc("a")] });
    const r = importDrive(db, { project: "P", files: [doc("a", { content: undefined })] });
    expect(r.updated).toBe(0);
    expect(getDriveFile(db, "a")?.content).toBe("# Doc a\n\nBody");
  });

  it("counts edits as updates", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", files: [doc("a")] });
    const r = importDrive(db, {
      project: "P",
      files: [doc("a", { modifiedTime: "2026-07-01T00:00:00Z", content: "# New" })],
    });
    expect(r).toMatchObject({ added: 0, updated: 1 });
    expect(getDriveFile(db, "a")?.content).toBe("# New");
  });

  it("marks files missing from a complete listing as removed, and revives them if they return", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", complete: true, files: [doc("a"), doc("b")] });
    const r = importDrive(db, { project: "P", complete: true, files: [doc("a", { content: undefined })] });
    expect(r.removed).toBe(1);
    expect(listDriveFiles(db, "P").map((f) => f.id)).toEqual(["a"]);
    expect(getDriveFile(db, "b")).toBeNull();
    expect(importDrive(db, { project: "P", files: [doc("b")] }).added).toBe(1);
  });

  it("does not remove anything for a partial listing", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", files: [doc("a"), doc("b")] });
    expect(importDrive(db, { project: "P", files: [doc("a")] }).removed).toBe(0);
  });

  it("leaves other projects alone", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", files: [doc("a")] });
    importDrive(db, { project: "Q", complete: true, files: [doc("z")] });
    expect(listDriveFiles(db, "P")).toHaveLength(1);
  });

  it("records a failed sync without touching files", () => {
    const db = openDb(":memory:");
    importDrive(db, { project: "P", files: [doc("a")] });
    importDrive(db, { project: "P", complete: true, error: "connector unavailable" });
    expect(listDriveFiles(db, "P")).toHaveLength(1);
    expect(lastDriveSync(db, "P")?.error).toBe("connector unavailable");
  });

  it("rejects files without required fields", () => {
    const db = openDb(":memory:");
    expect(() => importDrive(db, { project: "P", files: [{ id: "x" } as never] })).toThrow(/missing/);
  });
});
