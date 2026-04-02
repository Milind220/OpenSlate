/**
 * WorkerReturn — the structured reintegration contract between parent and child sessions.
 *
 * Every bounded child run (thread or query) returns exactly one WorkerReturn to the parent.
 * The parent orchestrator consumes these by default, not raw child transcripts.
 */

import type { SessionId, ArtifactId } from "./session.js";

export type WorkerReturnStatus = "completed" | "aborted" | "escalated";
export type ChildType = "thread" | "query";

export interface WorkerReturn {
  id: string;
  parentSessionId: SessionId;
  childSessionId: SessionId;
  childType: ChildType;
  alias: string | null;
  task: string;
  status: WorkerReturnStatus;
  /** Structured output from the child run. */
  output: string | null;
  /** Reference to the child session trace for drill-down. */
  traceRef: string | null;
  /** References to artifacts produced by the child run. */
  artifactRefs: ArtifactId[];
  startedAt: string;
  finishedAt: string | null;
}
