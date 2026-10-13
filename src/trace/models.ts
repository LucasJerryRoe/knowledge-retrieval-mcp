export type QueryStatus = "RUNNING" | "SUCCESS" | "FAILED" | "CRASHED";

export interface CandidateTrace {
  candidateId: string;
  queryId: string;
  knowledgeId: string;
  rank: number;
  score: number;
  title: string;
  excerpt: string;
  retrievalSnapshotHash: string;
}

export interface StoredCandidate {
  candidateId: string;
  queryId: string;
  knowledgeId: string;
  retrievalSnapshotHash: string;
  deletedAt: string | null;
}
