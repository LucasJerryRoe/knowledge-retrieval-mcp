import { randomUUID } from "node:crypto";

export type IdPrefix = "q" | "c" | "r" | "sess" | "srch" | "e";

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}
