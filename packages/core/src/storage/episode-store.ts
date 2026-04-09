/**
 * EpisodeStore — persistence for derived reintegration Episodes.
 */

import type Database from "bun:sqlite";
import type { SessionId, ArtifactId } from "../types/session.js";
import type { Episode, EpisodeRuntimeData } from "../types/episode.js";
import type {
  WorkerReturnStatus,
  ChildType,
  CompletionContractSignal,
} from "../types/worker-return.js";

interface EpisodeRow {
  id: string;
  parent_session_id: string;
  child_session_id: string;
  worker_return_id: string;
  child_type: string;
  alias: string | null;
  task: string;
  status: string;
  trace_ref: string | null;
  artifact_refs_json: string;
  input_episode_ids_json: string;
  summary: string | null;
  key_findings_json: string;
  files_read_json: string;
  files_changed_json: string;
  open_questions_json: string;
  next_actions_json: string;
  completion_contract_json: string;
  runtime_json: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

function asStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function asCompletionContract(raw: string): CompletionContractSignal {
  try {
    const parsed = JSON.parse(raw) as CompletionContractSignal;
    if (
      parsed &&
      (parsed.validity === "valid" ||
        parsed.validity === "missing" ||
        parsed.validity === "malformed") &&
      Array.isArray(parsed.issues)
    ) {
      return {
        validity: parsed.validity,
        issues: parsed.issues.filter((x): x is string => typeof x === "string"),
      };
    }
  } catch {
    // ignore
  }

  return {
    validity: "missing",
    issues: ["Missing completion contract payload on persisted episode."],
  };
}

function asRuntime(raw: string): EpisodeRuntimeData {
  try {
    const parsed = JSON.parse(raw) as EpisodeRuntimeData;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid runtime json");
    }

    return {
      iterations:
        typeof parsed.iterations === "number" && Number.isFinite(parsed.iterations)
          ? parsed.iterations
          : 0,
      structuredReturn:
        parsed.structuredReturn && typeof parsed.structuredReturn === "object"
          ? {
              summary:
                typeof parsed.structuredReturn.summary === "string" ||
                parsed.structuredReturn.summary == null
                  ? parsed.structuredReturn.summary
                  : null,
              keyFindings: Array.isArray(parsed.structuredReturn.keyFindings)
                ? parsed.structuredReturn.keyFindings.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
              filesRead: Array.isArray(parsed.structuredReturn.filesRead)
                ? parsed.structuredReturn.filesRead.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
              filesChanged: Array.isArray(parsed.structuredReturn.filesChanged)
                ? parsed.structuredReturn.filesChanged.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
              openQuestions: Array.isArray(parsed.structuredReturn.openQuestions)
                ? parsed.structuredReturn.openQuestions.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
              nextActions: Array.isArray(parsed.structuredReturn.nextActions)
                ? parsed.structuredReturn.nextActions.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
            }
          : null,
      completionContract: parsed.completionContract,
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
      filesRead: Array.isArray(parsed.filesRead)
        ? parsed.filesRead.filter((x): x is string => typeof x === "string")
        : [],
      filesChanged: Array.isArray(parsed.filesChanged)
        ? parsed.filesChanged.filter((x): x is string => typeof x === "string")
        : [],
      durationMs:
        typeof parsed.durationMs === "number" && Number.isFinite(parsed.durationMs)
          ? parsed.durationMs
          : null,
      model: typeof parsed.model === "string" ? parsed.model : null,
      tokenUsage:
        parsed.tokenUsage && typeof parsed.tokenUsage === "object"
          ? {
              promptTokens: parsed.tokenUsage.promptTokens ?? 0,
              completionTokens: parsed.tokenUsage.completionTokens ?? 0,
              totalTokens: parsed.tokenUsage.totalTokens ?? 0,
            }
          : null,
      estimatedCostUsd:
        typeof parsed.estimatedCostUsd === "number" &&
        Number.isFinite(parsed.estimatedCostUsd)
          ? parsed.estimatedCostUsd
          : null,
    };
  } catch {
    return {
      iterations: 0,
      structuredReturn: null,
      completionContract: {
        validity: "missing",
        issues: ["Missing episode runtime payload."],
      },
      toolCalls: [],
      filesRead: [],
      filesChanged: [],
      durationMs: null,
      model: null,
      tokenUsage: null,
      estimatedCostUsd: null,
    };
  }
}

function rowToEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id as SessionId,
    childSessionId: row.child_session_id as SessionId,
    workerReturnId: row.worker_return_id,
    childType: row.child_type as ChildType,
    alias: row.alias,
    task: row.task,
    status: row.status as WorkerReturnStatus,
    traceRef: row.trace_ref,
    artifactRefs: JSON.parse(row.artifact_refs_json) as ArtifactId[],
    inputEpisodeIds: asStringArray(row.input_episode_ids_json),
    summary: row.summary,
    keyFindings: asStringArray(row.key_findings_json),
    filesRead: asStringArray(row.files_read_json),
    filesChanged: asStringArray(row.files_changed_json),
    openQuestions: asStringArray(row.open_questions_json),
    nextActions: asStringArray(row.next_actions_json),
    completionContract: asCompletionContract(row.completion_contract_json),
    runtime: asRuntime(row.runtime_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export interface CreateEpisodeInput {
  parentSessionId: SessionId;
  childSessionId: SessionId;
  workerReturnId: string;
  childType: ChildType;
  alias?: string | null;
  task: string;
  status: WorkerReturnStatus;
  traceRef?: string | null;
  artifactRefs?: ArtifactId[];
  inputEpisodeIds?: string[];
  summary?: string | null;
  keyFindings?: string[];
  filesRead?: string[];
  filesChanged?: string[];
  openQuestions?: string[];
  nextActions?: string[];
  completionContract: CompletionContractSignal;
  runtime: EpisodeRuntimeData;
  startedAt: string;
  finishedAt?: string | null;
}

export interface EpisodeStore {
  create(input: CreateEpisodeInput): Episode;
  get(id: string): Episode | null;
  listByParent(parentSessionId: SessionId): Episode[];
  listByChild(childSessionId: SessionId): Episode[];
}

export function createEpisodeStore(db: Database): EpisodeStore {
  const insertStmt = db.prepare(`
    INSERT INTO episodes (
      id,
      parent_session_id,
      child_session_id,
      worker_return_id,
      child_type,
      alias,
      task,
      status,
      trace_ref,
      artifact_refs_json,
      input_episode_ids_json,
      summary,
      key_findings_json,
      files_read_json,
      files_changed_json,
      open_questions_json,
      next_actions_json,
      completion_contract_json,
      runtime_json,
      started_at,
      finished_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare("SELECT * FROM episodes WHERE id = ?");
  const listByParentStmt = db.prepare(
    "SELECT * FROM episodes WHERE parent_session_id = ? ORDER BY created_at DESC",
  );
  const listByChildStmt = db.prepare(
    "SELECT * FROM episodes WHERE child_session_id = ? ORDER BY created_at DESC",
  );

  return {
    create(input: CreateEpisodeInput): Episode {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      insertStmt.run(
        id,
        input.parentSessionId,
        input.childSessionId,
        input.workerReturnId,
        input.childType,
        input.alias ?? null,
        input.task,
        input.status,
        input.traceRef ?? null,
        JSON.stringify(input.artifactRefs ?? []),
        JSON.stringify(input.inputEpisodeIds ?? []),
        input.summary ?? null,
        JSON.stringify(input.keyFindings ?? []),
        JSON.stringify(input.filesRead ?? []),
        JSON.stringify(input.filesChanged ?? []),
        JSON.stringify(input.openQuestions ?? []),
        JSON.stringify(input.nextActions ?? []),
        JSON.stringify(input.completionContract),
        JSON.stringify(input.runtime),
        input.startedAt,
        input.finishedAt ?? null,
        createdAt,
      );

      return {
        id,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        workerReturnId: input.workerReturnId,
        childType: input.childType,
        alias: input.alias ?? null,
        task: input.task,
        status: input.status,
        traceRef: input.traceRef ?? null,
        artifactRefs: input.artifactRefs ?? [],
        inputEpisodeIds: input.inputEpisodeIds ?? [],
        summary: input.summary ?? null,
        keyFindings: input.keyFindings ?? [],
        filesRead: input.filesRead ?? [],
        filesChanged: input.filesChanged ?? [],
        openQuestions: input.openQuestions ?? [],
        nextActions: input.nextActions ?? [],
        completionContract: input.completionContract,
        runtime: input.runtime,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
        createdAt,
      };
    },

    get(id: string): Episode | null {
      const row = getStmt.get(id) as EpisodeRow | null;
      return row ? rowToEpisode(row) : null;
    },

    listByParent(parentSessionId: SessionId): Episode[] {
      return (listByParentStmt.all(parentSessionId) as EpisodeRow[]).map(
        rowToEpisode,
      );
    },

    listByChild(childSessionId: SessionId): Episode[] {
      return (listByChildStmt.all(childSessionId) as EpisodeRow[]).map(
        rowToEpisode,
      );
    },
  };
}
