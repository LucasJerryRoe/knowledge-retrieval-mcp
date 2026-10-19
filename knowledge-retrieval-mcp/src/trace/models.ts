export type SearchStatus = "RUNNING" | "SUCCESS" | "FAILED" | "CRASHED";
export type TaskStatus = "ACTIVE" | "CLOSED" | "ABANDONED";

export interface CandidateTrace {
  candidateId: string;
  searchId: string;
  knowledgeId: string;
  rank: number;
  score: number;
  title: string;
  excerpt: string;
  retrievalSnapshotHash: string;
}

export interface StoredCandidate {
  candidateId: string;
  searchId: string;
  knowledgeId: string;
  retrievalSnapshotHash: string;
  deletedAt: string | null;
}

export interface DocumentReadRecord {
  readId: string;
  taskId: string;
  knowledgeId: string;
  readSnapshotHash: string;
  retrievalSnapshotHash: string;
  versionChanged: number;
  adopted: number;
  searchCount: number;
}

export interface EvidenceRecord {
  evidenceId: string;
  readId: string;
  taskId: string;
  knowledgeId: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  reason: string;
}