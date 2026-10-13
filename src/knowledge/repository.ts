import { readFile, realpath } from "node:fs/promises";
import { sha256 } from "../common/hash.js";
import type { KnowledgeDocument, KnowledgeSnapshot } from "./document.js";
import { pathIsWithinRoot } from "./scanner.js";

export interface CurrentKnowledge {
  document: KnowledgeDocument;
  content: string;
  contentHash: string;
}

export class KnowledgeRepository {
  readonly #root: string;
  readonly #byId: Map<string, KnowledgeSnapshot>;

  constructor(root: string, snapshots: KnowledgeSnapshot[]) {
    this.#root = root;
    this.#byId = new Map(
      snapshots.map((snapshot) => [snapshot.document.knowledgeId, snapshot]),
    );
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
}
