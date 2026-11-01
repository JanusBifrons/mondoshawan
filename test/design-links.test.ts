import { describe, expect, it } from "vitest";
import { findNodeRef, wikiLinks } from "@/lib/design-links";

const tree = [
  { id: "g", parentId: null, title: "Galaxy map" },
  { id: "s", parentId: "g", title: "Sectors" },
  { id: "w", parentId: null, title: "Weapons" },
  { id: "m", parentId: "w", title: "Mines" },
  { id: "m2", parentId: "s", title: "Mines" }, // a second "Mines", under Sectors
];

describe("node links in design text", () => {
  it("finds nodes by id, title path, or a unique title", () => {
    expect(findNodeRef(tree, "s")?.id).toBe("s");
    expect(findNodeRef(tree, "Sectors")?.id).toBe("s");
    expect(findNodeRef(tree, "galaxy map / sectors")?.id).toBe("s");
    expect(findNodeRef(tree, "Weapons/Mines")?.id).toBe("m");
    expect(findNodeRef(tree, "Sectors/Mines")?.id).toBe("m2");
  });

  it("refuses an ambiguous or unknown title", () => {
    expect(findNodeRef(tree, "Mines")).toBeNull();
    expect(findNodeRef(tree, "Asteroids")).toBeNull();
  });

  it("turns [[wiki links]] into node: links", () => {
    expect(wikiLinks("an overview of [[Sectors]]")).toBe("an overview of [Sectors](node:Sectors)");
    expect(wikiLinks("see [[Galaxy map/Sectors|sectors]].")).toBe("see [sectors](node:Galaxy%20map/Sectors).");
    expect(wikiLinks("no links here")).toBe("no links here");
  });
});
