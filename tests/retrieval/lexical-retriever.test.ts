import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeRepository } from "../../src/knowledge/repository.js";
import { scanKnowledgeRoot } from "../../src/knowledge/scanner.js";
import {
  createExcerpt,
  LexicalRetriever,
} from "../../src/retrieval/lexical-retriever.js";
import { tokenize } from "../../src/retrieval/tokenizer.js";
import { createWiki } from "../helpers/wiki.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function createRetriever(files: Record<string, string>) {
  const root = await createWiki(files);
  roots.push(root);
  const scan = await scanKnowledgeRoot(root);
  return new LexicalRetriever(new KnowledgeRepository(scan.root, scan.snapshots));
}

describe("tokenize", () => {
  it("creates English words and Chinese bigrams with the original query", () => {
    expect(tokenize("Refund Timeout")).toEqual(["refund", "timeout"]);
    expect(tokenize("退款超时")).toEqual(["退款", "款超", "超时", "退款超时"]);
  });

  it("returns no tokens for punctuation-only input", () => {
    expect(tokenize("...！？")).toEqual([]);
  });
});

describe("LexicalRetriever", () => {
  it("ranks an exact title match above a body-only match", async () => {
    const retriever = await createRetriever({
      "exact.md": "# 退款超时\n请升级人工处理。",
      "body.md": `# 支付说明\n${"这里提到退款超时。".repeat(100)}`,
    });

    const results = await retriever.search("退款超时", { topK: 10 });
    expect(results.map((result) => result.knowledgeId)).toEqual([
      "exact",
      "body",
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("supports heading, body, English, no-hit, and topK behavior", async () => {
    const retriever = await createRetriever({
      "heading.md": "# Guide\n## Retry policy\nDetails",
      "body.md": "# Operations\nUse circuitbreaker for failures.",
      "other.md": "# Other\nNothing relevant.",
    });

    expect((await retriever.search("retry", { topK: 10 }))[0].knowledgeId).toBe(
      "heading",
    );
    expect(
      (await retriever.search("circuitbreaker", { topK: 10 }))[0].knowledgeId,
    ).toBe("body");
    expect(await retriever.search("absent-term", { topK: 10 })).toEqual([]);
    expect(await retriever.search("guide", { topK: 1 })).toHaveLength(1);
  });

  it("does not treat frontmatter metadata as body text", async () => {
    const retriever = await createRetriever({
      "metadata.md": "---\nid: privatekeyword\n---\n# Public title\nPublic body.",
    });

    expect(await retriever.search("privatekeyword", { topK: 10 })).toEqual([]);
  });
});

describe("createExcerpt", () => {
  it("uses the first hit, sentence boundaries, and a 600 character cap", () => {
    const content = `${"a".repeat(250)}。target sentence ends here。${"b".repeat(700)}`;
    const result = createExcerpt(content, ["target"]);
    expect(result.startsWith("target")).toBe(true);
    expect(result.endsWith("。")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(600);
  });

  it("falls back to the first 300 characters when there is no hit", () => {
    expect(createExcerpt("x".repeat(400), ["missing"])).toHaveLength(300);
  });
});
