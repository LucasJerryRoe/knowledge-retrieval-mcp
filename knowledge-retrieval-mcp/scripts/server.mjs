import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.TRACE_DB_PATH || join(__dirname, "..", "data", "trace.db");
const PORT = parseInt(process.env.PORT || "3100", 10);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

function query(sql, ...params) {
  return db.prepare(sql).all(...params);
}

// --- API handlers ---

function handleSummary() {
  return {
    tasks: query("SELECT COUNT(*) AS n FROM knowledge_task")[0].n,
    activeTasks: query("SELECT COUNT(*) AS n FROM knowledge_task WHERE status = 'ACTIVE'")[0].n,
    searches: query("SELECT COUNT(*) AS n FROM knowledge_search")[0].n,
    reads: query("SELECT COUNT(*) AS n FROM document_read")[0].n,
    evidence: query("SELECT COUNT(*) AS n FROM evidence")[0].n,
    docs: query("SELECT COUNT(*) AS n FROM knowledge_document WHERE deleted_at IS NULL")[0].n,
    typeDist: query(
      "SELECT semantic_type, COUNT(*) AS n FROM knowledge_document WHERE deleted_at IS NULL GROUP BY semantic_type"
    ),
    catDist: query(
      "SELECT category, COUNT(*) AS n, SUM(CASE WHEN semantic_type='entity' THEN 1 ELSE 0 END) AS entity, SUM(CASE WHEN semantic_type='concept' THEN 1 ELSE 0 END) AS concept, SUM(CASE WHEN semantic_type='unclassified' THEN 1 ELSE 0 END) AS unclassified FROM knowledge_document WHERE deleted_at IS NULL GROUP BY category ORDER BY n DESC"
    ),
  };
}

function handleTasks() {
  return query(`
    SELECT task_id, task_intent, conversation_id, index_version, status, search_count, document_read_count, evidence_count, created_at, closed_at
    FROM knowledge_task ORDER BY created_at DESC
  `);
}

function handleSearches(limit = 50) {
  return query(`
    SELECT s.search_id, s.task_id, s.query_text, s.top_k, s.status, s.candidate_count, s.latency_ms, s.error_message, s.created_at,
           COUNT(c.candidate_id) AS actual_candidates
    FROM knowledge_search s
    LEFT JOIN knowledge_candidate c ON c.search_id = s.search_id
    GROUP BY s.search_id
    ORDER BY s.created_at DESC LIMIT ?
  `, limit);
}

function handleCandidates(searchId) {
  if (searchId) {
    return query("SELECT * FROM knowledge_candidate WHERE search_id = ? ORDER BY rank", searchId);
  }
  return query("SELECT * FROM knowledge_candidate ORDER BY search_id DESC, rank LIMIT 100");
}

function handleReads() {
  return query(`
    SELECT r.*
    FROM document_read r
    ORDER BY r.created_at DESC LIMIT 50
  `);
}

function handleEvidence() {
  return query(`
    SELECT e.*
    FROM evidence e
    ORDER BY e.created_at DESC LIMIT 50
  `);
}

function handleDocs() {
  return query(`
    SELECT knowledge_id, path, title, category, semantic_type, deleted_at, content_hash, indexed_at
    FROM knowledge_document ORDER BY category, knowledge_id
  `);
}

function handleQualityOverview() {
  // 召回但从未被阅读的 candidate（跨所有 task 聚合）
  const recalledUnread = query(`
    SELECT c.knowledge_id, c.title, COUNT(DISTINCT c.candidate_id) AS recall_count,
           ROUND(AVG(c.score), 1) AS avg_score, ROUND(MAX(c.score), 1) AS max_score
    FROM knowledge_candidate c
    JOIN knowledge_search s ON s.search_id = c.search_id
    LEFT JOIN document_read r ON r.task_id = s.task_id AND r.knowledge_id = c.knowledge_id
    WHERE r.read_id IS NULL AND s.status = 'SUCCESS'
    GROUP BY c.knowledge_id
    ORDER BY recall_count DESC
  `);

  // 阅读了但未被采用的文档
  const readNotAdopted = query(`
    SELECT r.knowledge_id, COUNT(*) AS read_count
    FROM document_read r
    WHERE r.adopted = 0
    GROUP BY r.knowledge_id
    ORDER BY read_count DESC
  `);

  // 每个 task 的质量指标
  const taskQuality = query(`
    SELECT t.task_id, t.task_intent, t.status,
           t.search_count, t.document_read_count, t.evidence_count,
           (SELECT COUNT(DISTINCT c.knowledge_id)
            FROM knowledge_search s2
            JOIN knowledge_candidate c ON c.search_id = s2.search_id
            WHERE s2.task_id = t.task_id AND s2.status = 'SUCCESS') AS total_candidates,
           (SELECT COUNT(DISTINCT c.knowledge_id)
            FROM knowledge_search s2
            JOIN knowledge_candidate c ON c.search_id = s2.search_id
            WHERE s2.task_id = t.task_id AND s2.status = 'SUCCESS'
            AND c.knowledge_id NOT IN (
              SELECT r2.knowledge_id FROM document_read r2 WHERE r2.task_id = t.task_id
            )) AS unread_candidates,
           (SELECT COUNT(DISTINCT r3.knowledge_id)
            FROM document_read r3
            WHERE r3.task_id = t.task_id AND r3.adopted = 0) AS read_not_adopted
    FROM knowledge_task t
    ORDER BY t.created_at DESC
  `);

  return { recalledUnread, readNotAdopted, taskQuality };
}

function handleQualitySearches(params) {
  const taskFilter = params.get("task_id");
  const whereTask = taskFilter ? "AND s.task_id = ?" : "";

  // 每条搜索的质量指标
  const searches = taskFilter
    ? query(`
        SELECT s.search_id, t.task_id, t.task_intent, s.query_text, s.top_k, s.status,
               s.candidate_count, s.latency_ms, s.created_at
        FROM knowledge_search s
        JOIN knowledge_task t ON t.task_id = s.task_id
        WHERE s.status = 'SUCCESS' ` + whereTask + `
        ORDER BY s.created_at DESC
      `, taskFilter)
    : query(`
        SELECT s.search_id, t.task_id, t.task_intent, s.query_text, s.top_k, s.status,
               s.candidate_count, s.latency_ms, s.created_at
        FROM knowledge_search s
        JOIN knowledge_task t ON t.task_id = s.task_id
        WHERE s.status = 'SUCCESS'
        ORDER BY s.created_at DESC
      `);

  // 为每条搜索补充分层指标
  const enriched = searches.map((s) => {
    // 这条搜索的 candidates
    const candidates = query(`
      SELECT c.knowledge_id, c.title, c.rank, c.score
      FROM knowledge_candidate c
      WHERE c.search_id = ?
      ORDER BY c.rank
    `, s.search_id);

    // 被读了全文的 knowledge_id
    const readKIds = new Set(
      query(`
        SELECT knowledge_id FROM document_read WHERE search_id = ?
      `, s.search_id).map(r => r.knowledge_id)
    );

    // 被采用的 knowledge_id（adopted=1）
    const adoptedKIds = new Set(
      query(`
        SELECT knowledge_id FROM document_read WHERE search_id = ? AND adopted = 1
      `, s.search_id).map(r => r.knowledge_id)
    );

    const unreadCandidates = candidates.filter(c => !readKIds.has(c.knowledge_id));
    const readNotAdoptedCandidates = candidates.filter(c => readKIds.has(c.knowledge_id) && !adoptedKIds.has(c.knowledge_id));
    const adoptedCandidates = candidates.filter(c => adoptedKIds.has(c.knowledge_id));

    // 判断搜索质量
    const readCount = candidates.length - unreadCandidates.length;
    const adoptedCount = adoptedCandidates.length;
    let quality;
    if (adoptedCount > 0) {
      quality = "effective";       // 有证据产生
    } else if (readCount > 0) {
      quality = "knowledge_gap";   // 读了但无证据 → 知识缺失
    } else {
      quality = "unread";          // 全部未读 → 预览不匹配
    }

    return {
      searchId: s.search_id,
      taskId: s.task_id,
      taskIntent: s.task_intent,
      queryText: s.query_text,
      topK: s.top_k,
      latencyMs: s.latency_ms,
      candidateCount: candidates.length,
      readCount,
      adoptedCount,
      unreadCount: unreadCandidates.length,
      readNotAdoptedCount: readNotAdoptedCandidates.length,
      quality,
      unread: unreadCandidates,
      readNotAdopted: readNotAdoptedCandidates,
      adopted: adoptedCandidates,
      createdAt: s.created_at,
    };
  });

  return enriched;
}

function handleTaskDetail(taskId) {
  const task = query("SELECT * FROM knowledge_task WHERE task_id = ?", taskId)[0];
  if (!task) return null;
  const searches = query("SELECT * FROM knowledge_search WHERE task_id = ? ORDER BY created_at", taskId);
  const reads = query(`
    SELECT r.* FROM document_read r
    WHERE r.task_id = ?
    ORDER BY r.created_at
  `, taskId);
  const evidence = query(`
    SELECT e.* FROM evidence e
    WHERE e.task_id = ?
    ORDER BY e.created_at
  `, taskId);

  // Get candidates for each search
  const candidatesBySearch = {};
  for (const s of searches) {
    candidatesBySearch[s.search_id] = query("SELECT * FROM knowledge_candidate WHERE search_id = ? ORDER BY rank", s.search_id);
  }

  return { task, searches, reads, evidence, candidatesBySearch };
}

const LIVE_HTML = readFileSync(join(__dirname, "dashboard-live.html"), "utf8");

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LIVE_HTML);
      return;
    }

    // Parse /api/tasks/:id
    const taskMatch = url.pathname.match(/^\/api\/tasks\/(.+)$/);

    const routes = {
      "/api/summary": handleSummary,
      "/api/tasks": handleTasks,
      "/api/searches": () => handleSearches(parseInt(url.searchParams.get("limit") || "50")),
      "/api/candidates": () => handleCandidates(url.searchParams.get("search_id")),
      "/api/reads": handleReads,
      "/api/evidence": handleEvidence,
      "/api/docs": handleDocs,
      "/api/quality/overview": handleQualityOverview,
      "/api/quality/searches": () => handleQualitySearches(url.searchParams),
    };

    if (taskMatch) {
      const result = handleTaskDetail(decodeURIComponent(taskMatch[1]));
      if (!result) return json(res, { error: "Task not found" }, 404);
      return json(res, result);
    }

    const handler = routes[url.pathname];
    if (handler) return json(res, handler());

    json(res, { error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard server: http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
