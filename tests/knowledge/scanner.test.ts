import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanKnowledgeRoot } from "../../src/knowledge/scanner.js";
import { createWiki } from "../helpers/wiki.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("scanKnowledgeRoot", () => {
  it("scans markdown recursively and ignores hidden and dependency directories", async () => {
    const root = await createWiki({
      "a.md": "# A",
      "nested/b.MD": "# B",
      ".hidden/ignored.md": "# Hidden",
      "node_modules/pkg/ignored.md": "# Dependency",
    });
    roots.push(root);

    const scan = await scanKnowledgeRoot(root);
    expect(scan.snapshots.map(({ document }) => document.knowledgeId)).toEqual([
      "a",
      "nested/b",
    ]);
  });

  it("reports every path involved in a duplicate knowledge id", async () => {
    const root = await createWiki({
      "one.md": "---\nid: duplicate\n---\n# One",
      "nested/two.md": "---\nid: duplicate\n---\n# Two",
    });
    roots.push(root);

    const error = await scanKnowledgeRoot(root).catch(
      (caught: unknown) => caught as Error,
    );
    expect(error.message).toContain("Duplicate knowledgeId values:");
    expect(error.message).toContain("one.md");
    expect(error.message).toContain("two.md");
  });

  it("does not index symlinks that can escape the root", async () => {
    const root = await createWiki({ "inside.md": "# Inside" });
    const outside = await createWiki({ "outside.md": "# Outside" });
    roots.push(root, outside);
    await mkdir(path.join(root, "links"));
    await symlink(
      path.join(outside, "outside.md"),
      path.join(root, "links", "outside.md"),
    );
    await writeFile(path.join(root, ".ignored.md"), "# ignored");

    const scan = await scanKnowledgeRoot(root);
    expect(scan.snapshots).toHaveLength(1);
    expect(scan.snapshots[0].document.knowledgeId).toBe("inside");
  });
});
