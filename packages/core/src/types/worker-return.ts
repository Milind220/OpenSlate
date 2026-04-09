/**
 * WorkerReturn — completion marker for a bounded child run.
 *
 * WorkerReturn stays minimal by design and is kept separate from Episode.
 * Episode is derived after WorkerReturn persistence and carries reusable semantics.
 */

import type { SessionId, ArtifactId } from "./session.js";

export type WorkerReturnStatus = "completed" | "aborted" | "escalated";
export type ChildType = "thread" | "query";

export interface ToolCallSummary {
  toolCallId?: string;
  tool: string;
  args: Record<string, unknown>;
  result: string | null;
  isError: boolean;
}

export type CompletionContractValidity = "valid" | "missing" | "malformed";

export interface CompletionContractSignal {
  validity: CompletionContractValidity;
  issues: string[];
}

export interface WorkerReturn {
  id: string;
  parentSessionId: SessionId;
  childSessionId: SessionId;
  childType: ChildType;
  alias: string | null;
  task: string;
  status: WorkerReturnStatus;
  /** Structured output contract from the child run (opaque to parent until Episode derivation). */
  output: string | null;
  /** Reference to the child session trace for drill-down. */
  traceRef: string | null;
  /** References to artifacts produced by the child run. */
  artifactRefs: ArtifactId[];
  startedAt: string;
  finishedAt: string | null;
}
