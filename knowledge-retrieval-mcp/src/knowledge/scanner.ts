import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parseMarkdown } from "./markdown-parser.js";
import type { KnowledgeSnapshot } from "./document.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      if (entry.name.startsWith(".")) return [];
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return IGNORED_DIRECTORIES.has(entry.name)
          ? []
          : collectMarkdownFiles(entryPath);
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat();
}

export async function scanKnowledgeRoot(rootPath: string): Promise<{
  root: string;
  snapshots: KnowledgeSnapshot[];
}> {
  const root = await realpath(rootPath);
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`KNOWLEDGE_ROOT is not a directory: ${rootPath}`);
  }

  const files = (await collectMarkdownFiles(root)).sort();
  const snapshots = await Promise.all(
    files.map(async (filePath): Promise<KnowledgeSnapshot> => {
      const canonicalPath = await realpath(filePath);
      if (!isWithinRoot(root, canonicalPath)) {
        throw new Error(`Knowledge file resolves outside KNOWLEDGE_ROOT: ${filePath}`);
      }
      const content = await readFile(canonicalPath, "utf8");
      const relativePath = path.relative(root, canonicalPath);
      return {
        document: parseMarkdown(content, relativePath),
        absolutePath: canonicalPath,
      };
    }),
  );

  const byId = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    const paths = byId.get(snapshot.document.knowledgeId) ?? [];
    paths.push(snapshot.absolutePath);
    byId.set(snapshot.document.knowledgeId, paths);
  }
  const conflicts = [...byId.entries()].filter(([, paths]) => paths.length > 1);
  if (conflicts.length > 0) {
    const details = conflicts
      .map(([id, paths]) => `${id}:\n${paths.map((item) => `  - ${item}`).join("\n")}`)
      .join("\n");
    throw new Error(`Duplicate knowledgeId values:\n${details}`);
  }

  return { root, snapshots };
}

export function pathIsWithinRoot(root: string, target: string): boolean {
  return isWithinRoot(root, target);
}
