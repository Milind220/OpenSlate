/**
 * WorkerReturnStore — persistence layer for structured child returns.
 */

import type Database from "bun:sqlite";
import type { SessionId, ArtifactId } from "../types/session.js";
import type {
  WorkerReturn,
  WorkerReturnStatus,
  ChildType,
  ToolCallSummary,
  CompletionContractSignal,
} from "../types/worker-return.js";

interface WorkerReturnRow {
  id: string;
  parent_session_id: string;
  child_session_id: string;
  child_type: string;
  alias: string | null;
  task: string;
  status: string;
  output: string | null;
  trace_ref: string | null;
  artifact_refs_json: string;
  structured_json: string | null;
  started_at: string;
  finished_at: string | null;
}

interface WorkerReturnStructuredData {
  summary?: string | null;
  keyFindings?: string[];
  filesRead?: string[];
  filesChanged?: string[];
  toolCalls?: ToolCallSummary[];
  openQuestions?: string[];
  nextActions?: string[];
  completionContract?: CompletionContractSignal | null;
  durationMs?: number | null;
  model?: string | null;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
}

function parseStructuredJson(raw: string | null): WorkerReturnStructuredData {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as WorkerReturnStructuredData;
  } catch {
    return {};
  }
}

function rowToWorkerReturn(row: WorkerReturnRow): WorkerReturn {
  const structured = parseStructuredJson(row.structured_json);

  return {
    id: row.id,
    parentSessionId: row.parent_session_id as SessionId,
    childSessionId: row.child_session_id as SessionId,
    childType: row.child_type as ChildType,
    alias: row.alias,
    task: row.task,
    status: row.status as WorkerReturnStatus,
    output: row.output,
    traceRef: row.trace_ref,
    artifactRefs: JSON.parse(row.artifact_refs_json) as ArtifactId[],
    summary: structured.summary ?? null,
    keyFindings: structured.keyFindings ?? [],
    filesRead: structured.filesRead ?? [],
    filesChanged: structured.filesChanged ?? [],
    toolCalls: structured.toolCalls ?? [],
    openQuestions: structured.openQuestions ?? [],
    nextActions: structured.nextActions ?? [],
    completionContract: structured.completionContract ?? null,
    durationMs: structured.durationMs ?? null,
    model: structured.model ?? null,
    tokenUsage: structured.tokenUsage ?? null,
    estimatedCostUsd: structured.estimatedCostUsd ?? null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export interface CreateWorkerReturnInput {
  parentSessionId: SessionId;
  childSessionId: SessionId;
  childType?: ChildType;
  alias?: string | null;
  task: string;
  status: WorkerReturnStatus;
  output?: string | null;
  traceRef?: string | null;
  artifactRefs?: ArtifactId[];
  summary?: string | null;
  keyFindings?: string[];
  filesRead?: string[];
  filesChanged?: string[];
  toolCalls?: ToolCallSummary[];
  openQuestions?: string[];
  nextActions?: string[];
  completionContract?: CompletionContractSignal | null;
  durationMs?: number | null;
  model?: string | null;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface WorkerReturnStore {
  create(input: CreateWorkerReturnInput): WorkerReturn;
  get(id: string): WorkerReturn | null;
  listByParent(parentSessionId: SessionId): WorkerReturn[];
  listByChild(childSessionId: SessionId): WorkerReturn[];
}

export function createWorkerReturnStore(db: Database): WorkerReturnStore {
  const insertStmt = db.prepare(`
    INSERT INTO worker_returns (id, parent_session_id, child_session_id, child_type, alias, task, status, output, trace_ref, artifact_refs_json, structured_json, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare("SELECT * FROM worker_returns WHERE id = ?");
  const listByParentStmt = db.prepare(
    "SELECT * FROM worker_returns WHERE parent_session_id = ? ORDER BY started_at ASC",
  );
  const listByChildStmt = db.prepare(
    "SELECT * FROM worker_returns WHERE child_session_id = ? ORDER BY started_at ASC",
  );

  return {
    create(input: CreateWorkerReturnInput): WorkerReturn {
      const id = crypto.randomUUID();
      const structuredJson = JSON.stringify({
        summary: input.summary ?? null,
        keyFindings: input.keyFindings ?? [],
        filesRead: input.filesRead ?? [],
        filesChanged: input.filesChanged ?? [],
        toolCalls: input.toolCalls ?? [],
        openQuestions: input.openQuestions ?? [],
        nextActions: input.nextActions ?? [],
        completionContract: input.completionContract ?? null,
        durationMs: input.durationMs ?? null,
        model: input.model ?? null,
        tokenUsage: input.tokenUsage ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
      } satisfies WorkerReturnStructuredData);

      insertStmt.run(
        id,
        input.parentSessionId,
        input.childSessionId,
        input.childType ?? "thread",
        input.alias ?? null,
        input.task,
        input.status,
        input.output ?? null,
        input.traceRef ?? null,
        JSON.stringify(input.artifactRefs ?? []),
        structuredJson,
        input.startedAt,
        input.finishedAt ?? null,
      );

      return {
        id,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        childType: input.childType ?? "thread",
        alias: input.alias ?? null,
        task: input.task,
        status: input.status,
        output: input.output ?? null,
        traceRef: input.traceRef ?? null,
        artifactRefs: input.artifactRefs ?? [],
        summary: input.summary ?? null,
        keyFindings: input.keyFindings ?? [],
        filesRead: input.filesRead ?? [],
        filesChanged: input.filesChanged ?? [],
        toolCalls: input.toolCalls ?? [],
        openQuestions: input.openQuestions ?? [],
        nextActions: input.nextActions ?? [],
        completionContract: input.completionContract ?? null,
        durationMs: input.durationMs ?? null,
        model: input.model ?? null,
        tokenUsage: input.tokenUsage ?? null,
        estimatedCostUsd: input.estimatedCostUsd ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
      };
    },

    get(id: string): WorkerReturn | null {
      const row = getStmt.get(id) as WorkerReturnRow | null;
      return row ? rowToWorkerReturn(row) : null;
    },

    listByParent(parentSessionId: SessionId): WorkerReturn[] {
      return (listByParentStmt.all(parentSessionId) as WorkerReturnRow[]).map(
        rowToWorkerReturn,
      );
    },

    listByChild(childSessionId: SessionId): WorkerReturn[] {
      return (listByChildStmt.all(childSessionId) as WorkerReturnRow[]).map(
        rowToWorkerReturn,
      );
    },
  };
}
