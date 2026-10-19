import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/knowledge/markdown-parser.js";

describe("parseMarkdown", () => {
  it("uses frontmatter fields before headings and normalizes the id", () => {
    const raw = `---
id: payment-refund
title: Frontmatter title
summary: Refund policy
tags:
  - payment
  - refund
---
# Heading title
Body`;
    const document = parseMarkdown(raw, "payment/refund.md");

    expect(document).toMatchObject({
      knowledgeId: "payment-refund",
      path: "payment/refund.md",
      title: "Frontmatter title",
      summary: "Refund policy",
      tags: ["payment", "refund"],
      headings: ["Heading title"],
    });
    expect(document.content).toBe(raw);
    expect(document.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("falls back from the first H1 to the filename", () => {
    expect(parseMarkdown("# 中文标题\n正文", "guide/topic.md").title).toBe(
      "中文标题",
    );
    expect(parseMarkdown("No heading", "guide/no-heading.md")).toMatchObject({
      knowledgeId: "guide/no-heading",
      title: "no-heading",
    });
  });

  it("keeps repeated headings in source order", () => {
    const document = parseMarkdown("# Same\n## Child\n# Same", "same.md");
    expect(document.headings).toEqual(["Same", "Child", "Same"]);
  });
});
