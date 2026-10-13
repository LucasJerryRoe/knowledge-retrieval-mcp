import { createId } from "../common/id.js";
import { sha256 } from "../common/hash.js";
import { KnowledgeRepository } from "../knowledge/repository.js";
import { scanKnowledgeRoot } from "../knowledge/scanner.js";
import { LexicalRetriever } from "../retrieval/lexical-retriever.js";
import type { Retriever } from "../retrieval/retriever.js";
import { openDatabase, type SqliteDatabase } from "../storage/sqlite.js";
import { TraceRepository } from "../trace/repository.js";
import type { Config } from "./config.js";

export interface SearchPayload {
  query_id: string;
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
    const repository = new KnowledgeRepository(scan.root, scan.snapshots);
    const database = openDatabase(config.traceDbPath);
    const trace = new TraceRepository(database);
    trace.recoverOrphanedQueries();
    trace.syncKnowledge(repository.list());
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

  async search(
    query: string,
    requestedTopK: number | undefined,
    sessionId?: string,
  ): Promise<SearchPayload> {
    const queryId = createId("q");
    const topK = requestedTopK ?? this.config.defaultTopK;
    const startedAt = performance.now();
    this.trace.createQuery({
      queryId,
      sessionId,
      queryText: query,
      topK,
      indexVersion: this.indexVersion,
    });

    try {
      const trimmed = query.trim();
      if (trimmed.length < 1 || trimmed.length > 512) {
        throw new Error(
          `query length must be in [1, 512] after trim (got ${trimmed.length})`,
        );
      }
      if (!Number.isInteger(topK) || topK < 1 || topK > this.config.maxTopK) {
        throw new Error(`top_k must be an integer in [1, ${this.config.maxTopK}]`);
      }

      const results = await this.retriever.search(trimmed, { topK });
      const candidates = results.map((result, index) => {
        const document = this.repository.get(result.knowledgeId);
        if (!document) {
          throw new Error(`Retriever returned unknown knowledge: ${result.knowledgeId}`);
        }
        return {
          candidateId: createId("c"),
          queryId,
          knowledgeId: result.knowledgeId,
          rank: index + 1,
          score: result.score,
          title: result.title,
          excerpt: result.excerpt,
          retrievalSnapshotHash: document.contentHash,
        };
      });
      this.trace.completeQuery(
        queryId,
        candidates,
        Math.round(performance.now() - startedAt),
      );
      return {
        query_id: queryId,
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
      this.trace.failQuery(
        queryId,
        error,
        Math.round(performance.now() - startedAt),
      );
      throw error;
    }
  }

  async read(candidateId: string): Promise<ReadPayload> {
    const candidate = this.trace.findCandidate(candidateId);
    if (!candidate) return { error: "INVALID_CANDIDATE" };
    const startedAt = performance.now();

    let current;
    if (!candidate.deletedAt) {
      try {
        current = await this.repository.readCurrent(candidate.knowledgeId);
      } catch {
        current = undefined;
      }
    }
    if (!current) {
      this.trace.recordRead({
        readId: createId("r"),
        candidate,
        readSnapshotHash: "",
        latencyMs: Math.round(performance.now() - startedAt),
      });
      return { error: "KNOWLEDGE_GONE", knowledge_id: candidate.knowledgeId };
    }

    this.trace.recordRead({
      readId: createId("r"),
      candidate,
      readSnapshotHash: current.contentHash,
      latencyMs: Math.round(performance.now() - startedAt),
    });
    const changed = current.contentHash !== candidate.retrievalSnapshotHash;
    return {
      knowledge_id: candidate.knowledgeId,
      title: current.document.title,
      content: current.content,
      version: current.contentHash,
      ...(changed ? { warning: "Knowledge changed after retrieval." } : {}),
    };
  }
}
