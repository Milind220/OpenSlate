/**
 * Episode — durable reintegration artifact derived from a WorkerReturn and child runtime data.
 *
 * WorkerReturn captures completion status + trace linkage.
 * Episode captures reusable outcome semantics for future orchestration.
 */

import type { SessionId, ArtifactId } from "./session.js";
import type {
  WorkerReturnStatus,
  ChildType,
  CompletionContractSignal,
  ToolCallSummary,
} from "./worker-return.js";

export interface EpisodeRuntimeData {
  iterations: number;
  structuredReturn: {
    summary: string | null;
    keyFindings: string[];
    filesRead: string[];
    filesChanged: string[];
    openQuestions: string[];
    nextActions: string[];
  } | null;
  completionContract: CompletionContractSignal;
  toolCalls: ToolCallSummary[];
  filesRead: string[];
  filesChanged: string[];
  durationMs: number | null;
  model: string | null;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd: number | null;
}

export interface Episode {
  id: string;
  parentSessionId: SessionId;
  childSessionId: SessionId;
  workerReturnId: string;
  childType: ChildType;
  alias: string | null;
  task: string;
  status: WorkerReturnStatus;
  traceRef: string | null;
  artifactRefs: ArtifactId[];
  inputEpisodeIds: string[];
  summary: string | null;
  keyFindings: string[];
  filesRead: string[];
  filesChanged: string[];
  openQuestions: string[];
  nextActions: string[];
  completionContract: CompletionContractSignal;
  runtime: EpisodeRuntimeData;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}

export interface ChildPromptEpisode {
  id: string;
  alias: string | null;
  task: string;
  status: WorkerReturnStatus;
  summary: string | null;
  keyFindings: string[];
  filesRead: string[];
  filesChanged: string[];
  openQuestions: string[];
  nextActions: string[];
  finishedAt: string | null;
}

export interface EpisodeSelectionPolicy {
  maxForOrchestrator: number;
  maxForChildPrompt: number;
}

export const DEFAULT_EPISODE_SELECTION_POLICY: EpisodeSelectionPolicy = {
  maxForOrchestrator: 6,
  maxForChildPrompt: 3,
};
