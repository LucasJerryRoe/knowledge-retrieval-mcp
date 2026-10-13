import { rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/server/config.js";
import { KnowledgeRuntime } from "../../src/server/runtime.js";
import { openDatabase } from "../../src/storage/sqlite.js";
import { createWiki } from "../helpers/wiki.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function setup(files: Record<string, string>) {
  const root = await createWiki(files);
  roots.push(root);
  const dbPath = path.join(root, "trace.sqlite");
  const config: Config = {
    knowledgeRoot: root,
    traceDbPath: dbPath,
    defaultTopK: 8,
    maxTopK: 10,
  };
  return { root, dbPath, config, runtime: await KnowledgeRuntime.create(config) };
}

function row<T>(dbPath: string, sql: string): T {
  const database = new Database(dbPath, { readonly: true });
  try {
    return database.prepare(sql).get() as T;
  } finally {
    database.close();
  }
}

describe("KnowledgeRuntime", () => {
  it("records a complete query, candidate, and read chain with a session", async () => {
    const fixtureFiles = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `doc-${index}.md`,
        `# Document ${index}\nsharedterm content ${index}`,
      ]),
    );
    fixtureFiles["refund.md"] = "# 退款超时\n超过 24 小时请升级人工处理。";
    const { runtime, dbPath } = await setup(fixtureFiles);

    try {
      const search = await runtime.search("退款超时", 8, "session-1");
      expect(search.results[0]).toMatchObject({
        knowledge_id: "refund",
        rank: 1,
      });
      const read = await runtime.read(search.results[0].candidate_id);
      expect(read).toMatchObject({
        knowledge_id: "refund",
        title: "退款超时",
      });

      expect(
        row<{
          status: string;
          session_id: string;
          candidate_count: number;
          reads: number;
        }>(
          dbPath,
          `SELECT q.status, q.session_id, q.candidate_count,
                  COUNT(r.read_id) AS reads
           FROM retrieval_query q
           JOIN retrieval_candidate c ON c.query_id = q.query_id
           JOIN knowledge_read r ON r.candidate_id = c.candidate_id
           GROUP BY q.query_id`,
        ),
      ).toMatchObject({
        status: "SUCCESS",
        session_id: "session-1",
        candidate_count: 1,
        reads: 1,
      });
    } finally {
      runtime.close();
    }
  });

  it("records failed validation and treats punctuation as a successful no-hit", async () => {
    const { runtime, dbPath } = await setup({ "doc.md": "# Document\nBody" });
    try {
      await expect(runtime.search("   ", undefined)).rejects.toThrow(
        /query length/,
      );
      const noHit = await runtime.search("...！？", undefined);
      expect(noHit.results).toEqual([]);
      expect(
        row<{ failed: number; succeeded: number }>(
          dbPath,
          `SELECT
             SUM(status = 'FAILED') AS failed,
             SUM(status = 'SUCCESS') AS succeeded
           FROM retrieval_query`,
        ),
      ).toEqual({ failed: 1, succeeded: 1 });
    } finally {
      runtime.close();
    }
  });

  it("records version changes between retrieval and read", async () => {
    const { runtime, root, dbPath } = await setup({
      "doc.md": "# Versioned\nOriginal content",
    });
    try {
      const search = await runtime.search("Versioned", 1);
      await writeFile(path.join(root, "doc.md"), "# Versioned\nChanged content");
      const read = await runtime.read(search.results[0].candidate_id);

      expect(read).toMatchObject({
        warning: "Knowledge changed after retrieval.",
      });
      expect(
        row<{ version_changed: number }>(
          dbPath,
          "SELECT version_changed FROM knowledge_read",
        ).version_changed,
      ).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it("records a read when knowledge is deleted after retrieval", async () => {
    const { runtime, root, dbPath } = await setup({
      "gone.md": "# Gone\nTemporary content",
    });
    try {
      const search = await runtime.search("Gone", 1);
      await unlink(path.join(root, "gone.md"));
      await expect(runtime.read(search.results[0].candidate_id)).resolves.toEqual({
        error: "KNOWLEDGE_GONE",
        knowledge_id: "gone",
      });
      expect(
        row<{ hash: string; changed: number }>(
          dbPath,
          "SELECT read_snapshot_hash AS hash, version_changed AS changed FROM knowledge_read",
        ),
      ).toEqual({ hash: "", changed: 1 });
    } finally {
      runtime.close();
    }
  });

  it("soft-deletes missing documents and recovers orphaned queries on restart", async () => {
    const { runtime, root, dbPath, config } = await setup({
      "gone.md": "# Gone\nTemporary content",
    });
    const search = await runtime.search("Gone", 1);
    runtime.close();
    await unlink(path.join(root, "gone.md"));

    const database = openDatabase(dbPath);
    database
      .prepare(`
        INSERT INTO retrieval_query (
          query_id, query_text, top_k, retrieval_strategy, status, created_at
        ) VALUES ('q_orphan', 'orphan', 1, 'weighted_lexical_v1', 'RUNNING', ?)
      `)
      .run(new Date().toISOString());
    database.close();

    const restarted = await KnowledgeRuntime.create(config);
    try {
      expect(await restarted.read(search.results[0].candidate_id)).toEqual({
        error: "KNOWLEDGE_GONE",
        knowledge_id: "gone",
      });
      expect(
        row<{ status: string; deleted_at: string }>(
          dbPath,
          `SELECT q.status, d.deleted_at
           FROM retrieval_query q, knowledge_document d
           WHERE q.query_id = 'q_orphan' AND d.knowledge_id = 'gone'`,
        ),
      ).toMatchObject({ status: "CRASHED" });
    } finally {
      restarted.close();
    }
  });

  it("never reads a file replaced by a symlink outside the root", async () => {
    const { runtime, root } = await setup({ "doc.md": "# Safe\nSafe content" });
    const outside = await createWiki({ "secret.md": "# Secret\nOutside content" });
    roots.push(outside);
    try {
      const search = await runtime.search("Safe", 1);
      await unlink(path.join(root, "doc.md"));
      await symlink(path.join(outside, "secret.md"), path.join(root, "doc.md"));

      await expect(runtime.read(search.results[0].candidate_id)).resolves.toEqual({
        error: "KNOWLEDGE_GONE",
        knowledge_id: "doc",
      });
    } finally {
      runtime.close();
    }
  });

  it("rejects invalid candidate ids and topK values", async () => {
    const { runtime, dbPath } = await setup({ "doc.md": "# Document\nBody" });
    try {
      expect(await runtime.read("c_missing")).toEqual({
        error: "INVALID_CANDIDATE",
      });
      await expect(runtime.search("Document", 11)).rejects.toThrow(/top_k/);
      expect(
        row<{ reads: number; status: string }>(
          dbPath,
          `SELECT
             (SELECT COUNT(*) FROM knowledge_read) AS reads,
             (SELECT status FROM retrieval_query ORDER BY created_at DESC LIMIT 1) AS status`,
        ),
      ).toEqual({ reads: 0, status: "FAILED" });
    } finally {
      runtime.close();
    }
  });
});
