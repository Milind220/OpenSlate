/**
 * WorkerReturnStore — persistence layer for structured child returns.
 */

import type Database from "bun:sqlite";
import type { SessionId, ArtifactId } from "../types/session.js";
import type { WorkerReturn, WorkerReturnStatus, ChildType } from "../types/worker-return.js";

// ── Row shape ────────────────────────────────────────────────────────

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
  started_at: string;
  finished_at: string | null;
}

function rowToWorkerReturn(row: WorkerReturnRow): WorkerReturn {
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
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// ── Store Interface ──────────────────────────────────────────────────

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
  startedAt: string;
  finishedAt?: string | null;
}

export interface WorkerReturnStore {
  create(input: CreateWorkerReturnInput): WorkerReturn;
  get(id: string): WorkerReturn | null;
  listByParent(parentSessionId: SessionId): WorkerReturn[];
  listByChild(childSessionId: SessionId): WorkerReturn[];
}

// ── Implementation ───────────────────────────────────────────────────

export function createWorkerReturnStore(db: Database): WorkerReturnStore {
  const insertStmt = db.prepare(`
    INSERT INTO worker_returns (id, parent_session_id, child_session_id, child_type, alias, task, status, output, trace_ref, artifact_refs_json, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare("SELECT * FROM worker_returns WHERE id = ?");
  const listByParentStmt = db.prepare("SELECT * FROM worker_returns WHERE parent_session_id = ? ORDER BY started_at ASC");
  const listByChildStmt = db.prepare("SELECT * FROM worker_returns WHERE child_session_id = ? ORDER BY started_at ASC");

  return {
    create(input: CreateWorkerReturnInput): WorkerReturn {
      const id = crypto.randomUUID();
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
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
      };
    },

    get(id: string): WorkerReturn | null {
      const row = getStmt.get(id) as WorkerReturnRow | null;
      return row ? rowToWorkerReturn(row) : null;
    },

    listByParent(parentSessionId: SessionId): WorkerReturn[] {
      return (listByParentStmt.all(parentSessionId) as WorkerReturnRow[]).map(rowToWorkerReturn);
    },

    listByChild(childSessionId: SessionId): WorkerReturn[] {
      return (listByChildStmt.all(childSessionId) as WorkerReturnRow[]).map(rowToWorkerReturn);
    },
  };
}
