import type { SqliteDatabase } from "../storage/sqlite.js";
import type { CandidateTrace, EvidenceRecord, StoredCandidate } from "./models.js";

function now(): string {
  return new Date().toISOString();
}

export class TraceRepository {
  constructor(private readonly database: SqliteDatabase) {}

  recoverOrphans(): void {
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE knowledge_search SET status = 'CRASHED' WHERE status = 'RUNNING'")
        .run();
      this.database
        .prepare(`
          UPDATE knowledge_task
          SET status = 'ABANDONED', closed_at = ?
          WHERE status = 'ACTIVE'
            AND task_id IN (
              SELECT DISTINCT task_id FROM knowledge_search WHERE status IN ('RUNNING', 'CRASHED')
            )
        `)
        .run(now());
    })();
  }

  // ---- Layer 1: Knowledge Task ----

  createTask(input: {
    taskId: string;
    taskIntent: string;
    conversationId?: string;
    indexVersion: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO knowledge_task (
          task_id, task_intent, conversation_id, index_version, status, created_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)
      `)
      .run(input.taskId, input.taskIntent, input.conversationId ?? null, input.indexVersion, now());
  }

  closeTask(taskId: string): void {
    this.database
      .prepare("UPDATE knowledge_task SET status = 'CLOSED', closed_at = ? WHERE task_id = ?")
      .run(now(), taskId);
  }

  // ---- Search ----

  createSearch(input: {
    searchId: string;
    taskId: string;
    queryText: string;
    topK: number;
    indexVersion?: string;
  }): void {
    this.database
      .prepare(`
        INSERT INTO knowledge_search (
          search_id, task_id, query_text, top_k, retrieval_strategy,
          index_version, status, created_at
        ) VALUES (?, ?, ?, ?, 'weighted_lexical_v1', ?, 'RUNNING', ?)
      `)
      .run(input.searchId, input.taskId, input.queryText, input.topK, input.indexVersion ?? null, now());
  }

  completeSearch(searchId: string, candidates: CandidateTrace[], latencyMs: number): void {
    const insertCandidate = this.database.prepare(`
      INSERT INTO knowledge_candidate (
        candidate_id, search_id, knowledge_id, rank, score, title, excerpt,
        retrieval_snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const complete = this.database.prepare(`
      UPDATE knowledge_search
      SET status = 'SUCCESS', candidate_count = ?, latency_ms = ?, error_message = NULL
      WHERE search_id = ?
    `);
    const updateTask = this.database.prepare(`
      UPDATE knowledge_task SET search_count = search_count + 1 WHERE task_id = ?
    `);
    const createdAt = now();

    this.database.transaction(() => {
      for (const candidate of candidates) {
        insertCandidate.run(
          candidate.candidateId, candidate.searchId, candidate.knowledgeId,
          candidate.rank, candidate.score, candidate.title, candidate.excerpt,
          candidate.retrievalSnapshotHash, createdAt,
        );
      }
      complete.run(candidates.length, latencyMs, searchId);
      const row = this.database.prepare("SELECT task_id FROM knowledge_search WHERE search_id = ?").get(searchId) as { task_id: string } | undefined;
      if (row) updateTask.run(row.task_id);
    })();
  }

  failSearch(searchId: string, error: unknown, latencyMs: number): void {
    const message = error instanceof Error ? error.message : String(error);
    this.database
      .prepare(`
        UPDATE knowledge_search
        SET status = 'FAILED', candidate_count = 0, latency_ms = ?, error_message = ?
        WHERE search_id = ?
      `)
      .run(latencyMs, message, searchId);
  }

  // ---- Candidate lookup ----

  findCandidate(candidateId: string): StoredCandidate | undefined {
    const row = this.database
      .prepare(`
        SELECT c.candidate_id, c.search_id, c.knowledge_id,
               c.retrieval_snapshot_hash, d.deleted_at
        FROM knowledge_candidate c
        JOIN knowledge_document d ON d.knowledge_id = c.knowledge_id
        WHERE c.candidate_id = ?
      `)
      .get(candidateId) as
      | { candidate_id: string; search_id: string; knowledge_id: string; retrieval_snapshot_hash: string; deleted_at: string | null }
      | undefined;
    if (!row) return undefined;
    return {
      candidateId: row.candidate_id,
      searchId: row.search_id,
      knowledgeId: row.knowledge_id,
      retrievalSnapshotHash: row.retrieval_snapshot_hash,
      deletedAt: row.deleted_at,
    };
  }

  // ---- Layer 2: Document Read (per-task, deduped by knowledge_id) ----

  recordDocumentRead(input: {
    readId: string;
    taskId: string;
    knowledgeId: string;
    searchId: string;
    readSnapshotHash: string;
    retrievalSnapshotHash: string;
  }): void {
    const changed = Number(input.readSnapshotHash !== input.retrievalSnapshotHash);
    const createdAt = now();

    this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT read_id, search_count FROM document_read WHERE task_id = ? AND knowledge_id = ?")
        .get(input.taskId, input.knowledgeId) as { read_id: string; search_count: number } | undefined;

      if (existing) {
        this.database
          .prepare(`
            UPDATE document_read
            SET search_count = search_count + 1,
                read_snapshot_hash = ?,
                retrieval_snapshot_hash = ?,
                version_changed = ?,
                search_id = ?
            WHERE read_id = ?
          `)
          .run(input.readSnapshotHash, input.retrievalSnapshotHash, changed, input.searchId, existing.read_id);
      } else {
        this.database
          .prepare(`
            INSERT INTO document_read (
              read_id, task_id, knowledge_id, search_id,
              read_snapshot_hash, retrieval_snapshot_hash,
              version_changed, adopted, search_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
          `)
          .run(input.readId, input.taskId, input.knowledgeId, input.searchId,
            input.readSnapshotHash, input.retrievalSnapshotHash, changed, createdAt);
      }

      this.database
        .prepare("UPDATE knowledge_task SET document_read_count = document_read_count + 1 WHERE task_id = ?")
        .run(input.taskId);
    })();
  }

  markDocumentAdopted(taskId: string, knowledgeId: string): void {
    this.database
      .prepare("UPDATE document_read SET adopted = 1 WHERE task_id = ? AND knowledge_id = ?")
      .run(taskId, knowledgeId);
  }

  // ---- Layer 3: Evidence ----

  recordEvidence(input: EvidenceRecord): void {
    this.database
      .prepare(`
        INSERT INTO evidence (
          evidence_id, read_id, task_id, knowledge_id,
          line_start, line_end, snippet, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.evidenceId, input.readId, input.taskId, input.knowledgeId,
        input.lineStart, input.lineEnd, input.snippet, input.reason ?? null, now(),
      );

    this.database
      .prepare("UPDATE knowledge_task SET evidence_count = evidence_count + 1 WHERE task_id = ?")
      .run(input.taskId);
  }
}
