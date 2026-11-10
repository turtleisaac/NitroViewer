import { describe, expect, it } from "vitest";
import { ROM_CONTAINER } from "../transport";
import { bannerRowClass, folderDownloadName, matchCount, rowSelected, searchFiles, searchHitLabel, treePaneClass } from "./treeSearch";

describe("tree search", () => {
  const paths = {
    1: "/a/sprite.NCGR",
    2: "/a/other.NCLR",
    3: "/b/sprite2.NCGR",
  };

  it("returns nothing for a blank query", () => {
    expect(searchFiles(paths, "   ")).toEqual([]);
  });

  it("matches paths and sorts them", () => {
    expect(searchFiles(paths, "sprite").map((hit) => hit.id)).toEqual([1, 3]);
  });

  it("stops at 300 hits", () => {
    const many: Record<number, string> = {};
    for (let i = 0; i < 400; i++) many[i] = `/n/${i}.bin`;
    expect(searchFiles(many, "bin")).toHaveLength(300);
  });

  it("splits a hit into its name and directory", () => {
    expect(searchHitLabel("/a/sprite.NCGR", 1)).toEqual({ name: "sprite.NCGR", dir: "/a/" });
    expect(searchHitLabel("", 4)).toEqual({ name: "4", dir: "" });
  });

  it("marks only the selected file", () => {
    expect(rowSelected(null, 1)).toBe(false);
    expect(rowSelected({ ref: { container: ROM_CONTAINER, id: 2 } }, 1)).toBe(false);
    expect(rowSelected({ ref: { container: ROM_CONTAINER, id: 1 } }, 1)).toBe(true);
  });

  it("formats the capped match count and row classes", () => {
    expect(matchCount(3)).toBe("3");
    expect(matchCount(300)).toBe("300+");
    expect(treePaneClass(false)).toBe("pane tree-pane");
    expect(treePaneClass(true)).toBe("pane tree-pane open");
    expect(bannerRowClass(false)).not.toContain("selected");
    expect(bannerRowClass(true)).toContain("selected");
  });

  it("names a folder zip from the last segment", () => {
    expect(folderDownloadName("/field/build/")).toBe("build");
    expect(folderDownloadName("/")).toBe("filesystem");
    expect(folderDownloadName("/odd name!")).toBe("odd_name_");
  });
});