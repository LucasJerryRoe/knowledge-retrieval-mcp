import { readFile, realpath } from "node:fs/promises";
import { sha256 } from "../common/hash.js";
import type { SqliteDatabase } from "../storage/sqlite.js";
import {
  deriveCategory,
  deriveType,
  type KnowledgeDocument,
  type KnowledgeSnapshot,
  type ScorableDocument,
  type SemanticType,
} from "./document.js";
import { markdownBody } from "./markdown-parser.js";
import { pathIsWithinRoot } from "./scanner.js";

export interface CurrentKnowledge {
  document: KnowledgeDocument;
  content: string;
  contentHash: string;
}

export class KnowledgeRepository {
  readonly #root: string;
  readonly #byId: Map<string, KnowledgeSnapshot>;
  readonly #database: SqliteDatabase | undefined;

  constructor(root: string, snapshots: KnowledgeSnapshot[], database?: SqliteDatabase) {
    this.#root = root;
    this.#byId = new Map(
      snapshots.map((snapshot) => [snapshot.document.knowledgeId, snapshot]),
    );
    this.#database = database;
  }

  list(): KnowledgeDocument[] {
    return [...this.#byId.values()].map(({ document }) => document);
  }

  get(knowledgeId: string): KnowledgeDocument | undefined {
    return this.#byId.get(knowledgeId)?.document;
  }

  async readCurrent(knowledgeId: string): Promise<CurrentKnowledge | undefined> {
    const snapshot = this.#byId.get(knowledgeId);
    if (!snapshot) return undefined;

    let canonicalPath: string;
    try {
      canonicalPath = await realpath(snapshot.absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!pathIsWithinRoot(this.#root, canonicalPath)) {
      throw new Error(`Knowledge file resolves outside KNOWLEDGE_ROOT: ${knowledgeId}`);
    }

    let content: string;
    try {
      content = await readFile(canonicalPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return {
      document: snapshot.document,
      content,
      contentHash: sha256(content),
    };
  }

  // ---- 搜索索引（原 IndexRepository，现合并入 KnowledgeRepository） ----

  /** 将内存中的文档同步到 DB，包含 all 预计算搜索字段。 */
  syncToDb(): void {
    const db = this.#database;
    if (!db) return;

    const indexedAt = new Date().toISOString();
    const documents = this.list();
    const currentIds = new Set(documents.map((doc) => doc.knowledgeId));

    const upsert = db.prepare(`
      INSERT INTO knowledge_document (
        knowledge_id, path, title, title_lower, headings_lower,
        summary, summary_lower, body_lower,
        category, semantic_type, content_hash, indexed_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(knowledge_id) DO UPDATE SET
        path = excluded.path,
        title = excluded.title,
        title_lower = excluded.title_lower,
        headings_lower = excluded.headings_lower,
        summary = excluded.summary,
        summary_lower = excluded.summary_lower,
        body_lower = excluded.body_lower,
        category = excluded.category,
        semantic_type = excluded.semantic_type,
        content_hash = excluded.content_hash,
        indexed_at = excluded.indexed_at,
        deleted_at = NULL
    `);

    const listIds = db.prepare(
      "SELECT knowledge_id FROM knowledge_document WHERE deleted_at IS NULL",
    );
    const markDeleted = db.prepare(
      "UPDATE knowledge_document SET deleted_at = ? WHERE knowledge_id = ?",
    );

    db.transaction(() => {
      for (const doc of documents) {
        const body = markdownBody(doc.content).toLocaleLowerCase();
        upsert.run(
          doc.knowledgeId,
          doc.path,
          doc.title,
          doc.title.toLocaleLowerCase(),
          doc.headings.join("\n").toLocaleLowerCase(),
          doc.summary ?? null,
          (doc.summary ?? "").toLocaleLowerCase(),
          body,
          deriveCategory(doc.knowledgeId),
          deriveType(doc.knowledgeId, body),
          doc.contentHash,
          indexedAt,
        );
      }
      for (const row of listIds.all() as { knowledge_id: string }[]) {
        if (!currentIds.has(row.knowledge_id)) {
          markDeleted.run(indexedAt, row.knowledge_id);
        }
      }
    })();
  }

  /** 列出所有可评分文档，支持按 type 过滤（undefined = 不过滤 = 兜底） */
  listScorable(type?: SemanticType): ScorableDocument[] {
    const db = this.#database;
    if (!db) return [];

    let sql = `SELECT knowledge_id, title_lower, headings_lower, summary_lower, body_lower, category, semantic_type
      FROM knowledge_document WHERE deleted_at IS NULL`;
    const params: string[] = [];
    if (type) {
      sql += " AND semantic_type = ?";
      params.push(type);
    }
    return db.prepare(sql).all(...params).map(
      (row: any): ScorableDocument => ({
        knowledgeId: row.knowledge_id,
        titleLower: row.title_lower,
        headingsLower: row.headings_lower,
        summaryLower: row.summary_lower,
        bodyLower: row.body_lower,
        category: row.category,
        semanticType: row.semantic_type as SemanticType,
      }),
    );
  }

  indexCount(type?: SemanticType): number {
    const db = this.#database;
    if (!db) return 0;
    let sql = "SELECT COUNT(*) AS n FROM knowledge_document WHERE deleted_at IS NULL";
    if (type) sql += " AND semantic_type = ?";
    return (db.prepare(sql).get(...(type ? [type] : [])) as any).n;
  }
}
