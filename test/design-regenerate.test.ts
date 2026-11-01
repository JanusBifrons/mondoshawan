import { describe, expect, it } from "vitest";
import { evidenceFiles } from "@/lib/design-freshness";
import { regenerateInstruction } from "@/lib/design-regenerate";

describe("evidence files", () => {
  it("strips line ranges, de-duplicates and drops non-paths", () => {
    expect(
      evidenceFiles([
        "src/core/galaxy/galaxy.ts:105-358",
        "src/core/galaxy/galaxy.ts:12",
        "src\\server\\rooms\\SectorRoom.ts:92,118",
        "see the wiki",
        "../outside.ts",
        "README.md",
      ]),
    ).toEqual(["src/core/galaxy/galaxy.ts", "src/server/rooms/SectorRoom.ts", "README.md"]);
  });
});

describe("the fixed Regenerate instruction", () => {
  const project = { name: "EQX-Net", path: "C:/Users/a/eqx-net/eqx-net" };
  const text = regenerateInstruction(project, [
    { id: "g1", title: "Galaxy Map" },
    { id: "s1", title: "Sectors" },
  ]);

  it("lists the nodes and is pre-approved", () => {
    expect(text).toContain(`- "Galaxy Map" (id g1)`);
    expect(text).toContain(`- "Sectors" (id s1)`);
    expect(text).toContain("don't ask before writing");
  });

  it("reads the merged code, not the checked-out folder", () => {
    expect(text).toContain("origin/main");
    // The folder's path separators depend on the OS (CI is Linux), so match either.
    expect(text).toMatch(/git -C "C:[\\/]Users[\\/]a[\\/]eqx-net[\\/]eqx-net" show origin\/main:<path>/);
  });

  it("asks for the standard plain-English, linked style", () => {
    expect(text).toContain("zero context");
    expect(text).toContain("[[Title]]");
  });
});
