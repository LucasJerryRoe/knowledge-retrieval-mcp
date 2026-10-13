import { z } from "zod/v4";

const ConfigSchema = z.object({
  knowledgeRoot: z.string().min(1, "KNOWLEDGE_ROOT must be set"),
  traceDbPath: z.string().min(1, "TRACE_DB_PATH must be set"),
  defaultTopK: z.number().int().positive().default(8),
  maxTopK: z.number().int().positive().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.parse({
    knowledgeRoot: env.KNOWLEDGE_ROOT,
    traceDbPath: env.TRACE_DB_PATH,
    defaultTopK: env.DEFAULT_TOP_K ? Number(env.DEFAULT_TOP_K) : undefined,
    maxTopK: env.MAX_TOP_K ? Number(env.MAX_TOP_K) : undefined,
  });

  if (parsed.defaultTopK > parsed.maxTopK) {
    throw new Error(
      `DEFAULT_TOP_K (${parsed.defaultTopK}) must be <= MAX_TOP_K (${parsed.maxTopK})`,
    );
  }

  return parsed;
}
