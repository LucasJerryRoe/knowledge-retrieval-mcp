import { createId } from "../common/id.js";
import { sha256 } from "../common/hash.js";
import { KnowledgeRepository } from "../knowledge/repository.js";
import { scanKnowledgeRoot } from "../knowledge/scanner.js";
import { LexicalRetriever } from "../retrieval/lexical-retriever.js";
import type { Retriever } from "../retrieval/retriever.js";
import { openDatabase, type SqliteDatabase } from "../storage/sqlite.js";
import { TraceRepository } from "../trace/repository.js";
import type { SemanticType } from "../knowledge/document.js";
import type { Config } from "./config.js";

export interface SearchPayload {
  query_id: string;
  task_id: string;
  results: Array<{
    candidate_id: string;
    knowledge_id: string;
    title: string;
    rank: number;
    score: number;
    excerpt: string;
  }>;
}

export type ReadPayload =
  | {
      knowledge_id: string;
      title: string;
      content: string;
      version: string;
      warning?: string;
    }
  | { error: "INVALID_CANDIDATE" | "KNOWLEDGE_GONE"; knowledge_id?: string };

export class KnowledgeRuntime {
  private constructor(
    readonly config: Config,
    private readonly repository: KnowledgeRepository,
    private readonly retriever: Retriever,
    private readonly trace: TraceRepository,
    private readonly database: SqliteDatabase,
    private readonly indexVersion: string,
  ) {}

  static async create(config: Config): Promise<KnowledgeRuntime> {
    const scan = await scanKnowledgeRoot(config.knowledgeRoot);
    const database = openDatabase(config.traceDbPath);
    const repository = new KnowledgeRepository(scan.root, scan.snapshots, database);
    const trace = new TraceRepository(database);
    trace.recoverOrphans();
    repository.syncToDb();

    const indexVersion = sha256(
      repository
        .list()
        .map((document) => `${document.knowledgeId}:${document.contentHash}`)
        .sort()
        .join("\n"),
    );
    return new KnowledgeRuntime(
      config,
      repository,
      new LexicalRetriever(repository),
      trace,
      database,
      indexVersion,
    );
  }

  close(): void {
    this.database.close();
  }

  // ---- Layer 1: Search ----

  async search(
    query: string,
    requestedTopK: number | undefined,
    taskId: string,
    conversationId?: string,
    type?: SemanticType,
  ): Promise<SearchPayload> {
    const searchId = createId("srch");
    const topK = requestedTopK ?? this.config.defaultTopK;
    const startedAt = performance.now();

    // 确保 task 存在
    this.ensureTask(taskId, conversationId);
    this.trace.createSearch({
      searchId,
      taskId,
      queryText: query,
      topK,
      indexVersion: this.indexVersion,
    });

    try {
      const trimmed = query.trim();
      if (trimmed.length < 1 || trimmed.length > 512) {
        throw new Error(`query length must be in [1, 512] after trim (got ${trimmed.length})`);
      }
      if (!Number.isInteger(topK) || topK < 1 || topK > this.config.maxTopK) {
        throw new Error(`top_k must be an integer in [1, ${this.config.maxTopK}]`);
      }

      const results = await this.retriever.search(trimmed, { topK, type });
      const candidates = results.map((result, index) => {
        const document = this.repository.get(result.knowledgeId);
        if (!document) {
          throw new Error(`Retriever returned unknown knowledge: ${result.knowledgeId}`);
        }
        return {
          candidateId: createId("c"),
          searchId,
          knowledgeId: result.knowledgeId,
          rank: index + 1,
          score: result.score,
          title: result.title,
          excerpt: result.excerpt,
          retrievalSnapshotHash: document.contentHash,
        };
      });
      this.trace.completeSearch(
        searchId,
        candidates,
        Math.round(performance.now() - startedAt),
      );
      return {
        query_id: searchId,
        task_id: taskId,
        results: candidates.map((candidate) => ({
          candidate_id: candidate.candidateId,
          knowledge_id: candidate.knowledgeId,
          title: candidate.title,
          rank: candidate.rank,
          score: candidate.score,
          excerpt: candidate.excerpt,
        })),
      };
    } catch (error) {
      this.trace.failSearch(
        searchId,
        error,
        Math.round(performance.now() - startedAt),
      );
      throw error;
    }
  }

  // ---- Layer 2 + 3: Read + Evidence ----

  async citeEvidence(input: {
    candidate_id: string;
    line_start: number;
    line_end: number;
    snippet: string;
    reason?: string;
  }): Promise<{ evidence_id: string }> {
    const candidate = this.trace.findCandidate(input.candidate_id);
    if (!candidate) throw new Error("INVALID_CANDIDATE");

    const taskId = this.getTaskForSearch(candidate.searchId);
    if (!taskId) throw new Error("TASK_NOT_FOUND");

    // 查找或确认 document_read 存在
    const readRow = this.database
      .prepare("SELECT read_id FROM document_read WHERE task_id = ? AND knowledge_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(taskId, candidate.knowledgeId) as { read_id: string } | undefined;

    if (!readRow) {
      throw new Error("READ_NOT_FOUND: must call read_knowledge before cite_evidence");
    }

    this.trace.markDocumentAdopted(taskId, candidate.knowledgeId);

    const evidenceId = createId("e");
    this.trace.recordEvidence({
      evidenceId,
      readId: readRow.read_id,
      taskId,
      knowledgeId: candidate.knowledgeId,
      lineStart: input.line_start,
      lineEnd: input.line_end,
      snippet: input.snippet,
      reason: input.reason ?? "",
    });

    return { evidence_id: evidenceId };
  }

  async read(candidateId: string): Promise<ReadPayload> {
    const candidate = this.trace.findCandidate(candidateId);
    if (!candidate) return { error: "INVALID_CANDIDATE" };

    // 从搜索记录推导 task_id
    const taskId = this.getTaskForSearch(candidate.searchId);

    let current;
    if (!candidate.deletedAt) {
      try {
        current = await this.repository.readCurrent(candidate.knowledgeId);
      } catch {
        current = undefined;
      }
    }
    if (!current) {
      if (taskId) {
        this.trace.recordDocumentRead({
          readId: createId("r"),
          taskId,
          knowledgeId: candidate.knowledgeId,
          searchId: candidate.searchId,
          readSnapshotHash: "",
          retrievalSnapshotHash: candidate.retrievalSnapshotHash,
        });
      }
      return { error: "KNOWLEDGE_GONE", knowledge_id: candidate.knowledgeId };
    }

    if (taskId) {
      this.trace.recordDocumentRead({
        readId: createId("r"),
        taskId,
        knowledgeId: candidate.knowledgeId,
        searchId: candidate.searchId,
        readSnapshotHash: current.contentHash,
        retrievalSnapshotHash: candidate.retrievalSnapshotHash,
      });
    }

    const changed = current.contentHash !== candidate.retrievalSnapshotHash;
    return {
      knowledge_id: candidate.knowledgeId,
      title: current.document.title,
      content: current.content,
      version: current.contentHash,
      ...(changed ? { warning: "Knowledge changed after retrieval." } : {}),
    };
  }

  // ---- Helpers ----

  private ensureTask(taskId: string, conversationId?: string): void {
    const row = this.database
      .prepare("SELECT task_id FROM knowledge_task WHERE task_id = ?")
      .get(taskId);
    if (!row) {
      this.trace.createTask({
        taskId,
        taskDesc: taskId,
        conversationId,
        indexVersion: this.indexVersion,
      });
    }
  }

  private getTaskForSearch(searchId: string): string | undefined {
    const row = this.database
      .prepare("SELECT task_id FROM knowledge_search WHERE search_id = ?")
      .get(searchId) as { task_id: string } | undefined;
    return row?.task_id;
  }
}