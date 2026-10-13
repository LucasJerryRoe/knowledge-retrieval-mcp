import type { KnowledgeDocument } from "../knowledge/document.js";
import type { SqliteDatabase } from "../storage/sqlite.js";
import type { CandidateTrace, StoredCandidate } from "./models.js";

function now(): string {
  return new Date().toISOString();
}

export class TraceRepository {
  constructor(private readonly database: SqliteDatabase) {}

  syncKnowledge(documents: KnowledgeDocument[]): void {
    const indexedAt = now();
    const currentIds = new Set(documents.map((document) => document.knowledgeId));
    const upsert = this.database.prepare(`
      INSERT INTO knowledge_document (
        knowledge_id, path, title, summary, content_hash, indexed_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(knowledge_id) DO UPDATE SET
        path = excluded.path,
        title = excluded.title,
        summary = excluded.summary,
        content_hash = excluded.content_hash,
        indexed_at = excluded.indexed_at,
        deleted_at = NULL
    `);
    const listIds = this.database.prepare(
      "SELECT knowledge_id FROM knowledge_document WHERE deleted_at IS NULL",
    );
    const markDeleted = this.database.prepare(
      "UPDATE knowledge_document SET deleted_at = ? WHERE knowledge_id = ?",
    );

    this.database.transaction(() => {
      for (const document of documents) {
        upsert.run(
          document.knowledgeId,
          document.path,
          document.title,
          document.summary ?? null,
          document.contentHash,
          indexedAt,
        );
      }
      for (const row of listIds.all() as Array<{ knowledge_id: string }>) {
        if (!currentIds.has(row.knowledge_id)) {
          markDeleted.run(indexedAt, row.knowledge_id);
        }
      }
    })();
  }

  recoverOrphanedQueries(): number {
    return this.database
      .prepare(
        "UPDATE retrieval_query SET status = 'CRASHED' WHERE status = 'RUNNING'",
      )
      .run().changes;
  }

  createQuery(input: {
    queryId: string;
    sessionId?: string;
    queryText: string;
    topK: number;
    indexVersion?: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO retrieval_query (
          query_id, session_id, query_text, top_k, retrieval_strategy,
          index_version, status, created_at
        ) VALUES (?, ?, ?, ?, 'weighted_lexical_v1', ?, 'RUNNING', ?)
      `)
      .run(
        input.queryId,
        input.sessionId ?? null,
        input.queryText,
        input.topK,
        input.indexVersion ?? null,
        now(),
      );
  }

  completeQuery(queryId: string, candidates: CandidateTrace[], latencyMs: number): void {
    const insertCandidate = this.database.prepare(`
      INSERT INTO retrieval_candidate (
        candidate_id, query_id, knowledge_id, rank, score, title, excerpt,
        retrieval_snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const complete = this.database.prepare(`
      UPDATE retrieval_query
      SET status = 'SUCCESS', candidate_count = ?, latency_ms = ?, error_message = NULL
      WHERE query_id = ?
    `);
    const createdAt = now();

    this.database.transaction(() => {
      for (const candidate of candidates) {
        insertCandidate.run(
          candidate.candidateId,
          candidate.queryId,
          candidate.knowledgeId,
          candidate.rank,
          candidate.score,
          candidate.title,
          candidate.excerpt,
          candidate.retrievalSnapshotHash,
          createdAt,
        );
      }
      complete.run(candidates.length, latencyMs, queryId);
    })();
  }

  failQuery(queryId: string, error: unknown, latencyMs: number): void {
    const message = error instanceof Error ? error.message : String(error);
    this.database
      .prepare(`
        UPDATE retrieval_query
        SET status = 'FAILED', candidate_count = 0, latency_ms = ?, error_message = ?
        WHERE query_id = ?
      `)
      .run(latencyMs, message, queryId);
  }

  findCandidate(candidateId: string): StoredCandidate | undefined {
    const row = this.database
      .prepare(`
        SELECT c.candidate_id, c.query_id, c.knowledge_id,
               c.retrieval_snapshot_hash, d.deleted_at
        FROM retrieval_candidate c
        JOIN knowledge_document d ON d.knowledge_id = c.knowledge_id
        WHERE c.candidate_id = ?
      `)
      .get(candidateId) as
      | {
          candidate_id: string;
          query_id: string;
          knowledge_id: string;
          retrieval_snapshot_hash: string;
          deleted_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      candidateId: row.candidate_id,
      queryId: row.query_id,
      knowledgeId: row.knowledge_id,
      retrievalSnapshotHash: row.retrieval_snapshot_hash,
      deletedAt: row.deleted_at,
    };
  }

  recordRead(input: {
    readId: string;
    candidate: StoredCandidate;
    readSnapshotHash: string;
    latencyMs: number;
  }): void {
    this.database
      .prepare(`
        INSERT INTO knowledge_read (
          read_id, candidate_id, query_id, knowledge_id, read_snapshot_hash,
          version_changed, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.readId,
        input.candidate.candidateId,
        input.candidate.queryId,
        input.candidate.knowledgeId,
        input.readSnapshotHash,
        Number(input.readSnapshotHash !== input.candidate.retrievalSnapshotHash),
        input.latencyMs,
        now(),
      );
  }
}
