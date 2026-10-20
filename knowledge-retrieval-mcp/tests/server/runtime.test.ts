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
  it("migrates the legacy task_desc column to task_intent", async () => {
    const root = await createWiki({ "doc.md": "# Document\nBody" });
    roots.push(root);
    const dbPath = path.join(root, "legacy.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE knowledge_task (
        task_id TEXT PRIMARY KEY,
        task_desc TEXT NOT NULL,
        conversation_id TEXT,
        index_version TEXT NOT NULL,
        status TEXT NOT NULL,
        search_count INTEGER NOT NULL DEFAULT 0,
        document_read_count INTEGER NOT NULL DEFAULT 0,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
      INSERT INTO knowledge_task (
        task_id, task_desc, index_version, status, created_at
      ) VALUES (
        'legacy-task', '历史任务描述', 'v1', 'ACTIVE', '2026-10-19T00:00:00Z'
      );
    `);
    legacy.close();

    const migrated = openDatabase(dbPath);
    try {
      const columns = migrated
        .prepare("PRAGMA table_info(knowledge_task)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("task_intent");
      expect(columns.map((column) => column.name)).not.toContain("task_desc");
      expect(
        migrated
          .prepare("SELECT task_intent FROM knowledge_task WHERE task_id = 'legacy-task'")
          .get(),
      ).toEqual({ task_intent: "历史任务描述" });
    } finally {
      migrated.close();
    }
  });

  it("records a complete search, candidate, and document_read chain with a task intent", async () => {
    const fixtureFiles = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `doc-${index}.md`,
        `# Document ${index}\nsharedterm content ${index}`,
      ]),
    );
    fixtureFiles["refund.md"] = "# 退款超时\n超过 24 小时请升级人工处理。";
    const { runtime, dbPath } = await setup(fixtureFiles);

    try {
      const search = await runtime.search(
        "退款超时",
        8,
        "refund-timeout",
        "确认退款超时后的处理规则",
      );
      expect(search.results[0]).toMatchObject({
        knowledge_id: "refund",
        rank: 1,
      });
      expect(search).toMatchObject({
        task_id: "refund-timeout",
        task_intent: "确认退款超时后的处理规则",
      });
      const read = await runtime.read(search.results[0].candidate_id);
      expect(read).toMatchObject({
        knowledge_id: "refund",
        title: "退款超时",
      });

      expect(
        row<{
          status: string;
          task_id: string;
          candidate_count: number;
          reads: number;
        }>(
          dbPath,
          `SELECT s.status, s.task_id, s.candidate_count,
                  COUNT(dr.read_id) AS reads
           FROM knowledge_search s
           JOIN document_read dr ON dr.task_id = s.task_id
           GROUP BY s.search_id`,
        ),
      ).toMatchObject({
        status: "SUCCESS",
        task_id: "refund-timeout",
        candidate_count: 1,
        reads: 1,
      });

      expect(
        row<{
          task_intent: string;
          status: string;
          search_count: number;
          document_read_count: number;
        }>(
          dbPath,
          "SELECT task_intent, status, search_count, document_read_count FROM knowledge_task WHERE task_id = 'refund-timeout'",
        ),
      ).toMatchObject({
        task_intent: "确认退款超时后的处理规则",
        status: "ACTIVE",
        search_count: 1,
        document_read_count: 1,
      });
    } finally {
      runtime.close();
    }
  });

  it("records failed validation and treats punctuation as a successful no-hit", async () => {
    const { runtime, dbPath } = await setup({ "doc.md": "# Document\nBody" });
    try {
      await expect(runtime.search("   ", undefined, "validation", "验证查询输入")).rejects.toThrow(
        /query length/,
      );
      const noHit = await runtime.search("...！？", undefined, "punctuation", "验证标点查询");
      expect(noHit.results).toEqual([]);
      expect(
        row<{ failed: number; succeeded: number }>(
          dbPath,
          `SELECT
             SUM(status = 'FAILED') AS failed,
             SUM(status = 'SUCCESS') AS succeeded
           FROM knowledge_search`,
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
      const search = await runtime.search("Versioned", 1, "versioned", "读取版本变化后的文档");
      await writeFile(path.join(root, "doc.md"), "# Versioned\nChanged content");
      const read = await runtime.read(search.results[0].candidate_id);

      expect(read).toMatchObject({
        warning: "Knowledge changed after retrieval.",
      });
      expect(
        row<{ version_changed: number }>(
          dbPath,
          "SELECT version_changed FROM document_read",
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
      const search = await runtime.search("Gone", 1, "gone", "读取已删除文档");
      await unlink(path.join(root, "gone.md"));
      await expect(runtime.read(search.results[0].candidate_id)).resolves.toEqual({
        error: "KNOWLEDGE_GONE",
        knowledge_id: "gone",
      });
      expect(
        row<{ hash: string; changed: number }>(
          dbPath,
          "SELECT read_snapshot_hash AS hash, version_changed AS changed FROM document_read",
        ),
      ).toEqual({ hash: "", changed: 1 });
    } finally {
      runtime.close();
    }
  });

  it("soft-deletes missing documents and recovers orphaned searches on restart", async () => {
    const { runtime, root, dbPath, config } = await setup({
      "gone.md": "# Gone\nTemporary content",
    });
    const search = await runtime.search("Gone", 1, "gone", "读取已删除文档");
    runtime.close();
    await unlink(path.join(root, "gone.md"));

    const database = openDatabase(dbPath);
    // 手动插入孤儿 task（模拟崩溃前已存在）和孤儿 search
    database
      .prepare(`
        INSERT INTO knowledge_task (
          task_id, task_intent, index_version, status, created_at
        ) VALUES ('orphan-task', '恢复孤儿搜索', 'v1', 'ACTIVE', ?)
      `)
      .run(new Date().toISOString());
    database
      .prepare(`
        INSERT INTO knowledge_search (
          search_id, task_id, query_text, top_k, retrieval_strategy, status, created_at
        ) VALUES ('srch_orphan', 'orphan-task', 'orphan', 1, 'weighted_lexical_v1', 'RUNNING', ?)
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
          `SELECT s.status, d.deleted_at
           FROM knowledge_search s, knowledge_document d
           WHERE s.search_id = 'srch_orphan' AND d.knowledge_id = 'gone'`,
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
      const search = await runtime.search("Safe", 1, "safe", "读取安全文档");
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
      await expect(runtime.search("Document", 11, "document", "查询文档")).rejects.toThrow(/top_k/);
      expect(
        row<{ reads: number; status: string }>(
          dbPath,
          `SELECT
             (SELECT COUNT(*) FROM document_read) AS reads,
             (SELECT status FROM knowledge_search ORDER BY created_at DESC LIMIT 1) AS status`,
        ),
      ).toEqual({ reads: 0, status: "FAILED" });
    } finally {
      runtime.close();
    }
  });

  it("rejects a task_id reused with a different task intent", async () => {
    const { runtime } = await setup({ "doc.md": "# Document\nBody" });
    try {
      await runtime.search("Document", 1, "document-lookup", "查询文档内容");
      await expect(
        runtime.search("Body", 1, "document-lookup", "确认文档正文内容"),
      ).rejects.toThrow(/TASK_INTENT_MISMATCH/);
    } finally {
      runtime.close();
    }
  });
});
