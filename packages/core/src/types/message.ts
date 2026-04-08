/**
 * Message and MessagePart types.
 *
 * Messages use structured parts so the UI, compaction engine,
 * and orchestrator can reason over them without text scraping.
 */

import type { SessionId, MessageId, ArtifactId } from "./session.js";

// ── Message ──────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: MessageId;
  sessionId: SessionId;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: string;
}

// ── MessagePart ──────────────────────────────────────────────────────

export type MessagePartKind =
  | "text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "snapshot"
  | "patch"
  | "agent"
  | "status"
  | "handoff"
  | "summary_marker"
  | "worker_return_ref"
  | "approval_request"
  | "approval_result";

/**
 * Base shape for all message parts.
 * Each part is typed by its kind discriminant.
 */
export interface MessagePartBase {
  kind: MessagePartKind;
}

export interface TextPart extends MessagePartBase {
  kind: "text";
  content: string;
}

export interface ReasoningPart extends MessagePartBase {
  kind: "reasoning";
  content: string;
}

export interface ToolCallPart extends MessagePartBase {
  kind: "tool_call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultPart extends MessagePartBase {
  kind: "tool_result";
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export interface SnapshotPart extends MessagePartBase {
  kind: "snapshot";
  ref: ArtifactId;
}

export interface PatchPart extends MessagePartBase {
  kind: "patch";
  ref: ArtifactId;
}

export interface AgentPart extends MessagePartBase {
  kind: "agent";
  content: string;
}

export interface StatusPart extends MessagePartBase {
  kind: "status";
  content: string;
}

export interface HandoffPart extends MessagePartBase {
  kind: "handoff";
  summary: string;
}

export interface SummaryMarkerPart extends MessagePartBase {
  kind: "summary_marker";
  summary: string;
  compressedUpToIndex: number;
}

export interface WorkerReturnRefPart extends MessagePartBase {
  kind: "worker_return_ref";
  workerReturnId: string;
}

export interface ApprovalRequestPart extends MessagePartBase {
  kind: "approval_request";
  toolCallId: string;
  toolName: string;
  description: string;
}

export interface ApprovalResultPart extends MessagePartBase {
  kind: "approval_result";
  toolCallId: string;
  approved: boolean;
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | StatusPart
  | HandoffPart
  | SummaryMarkerPart
  | WorkerReturnRefPart
  | ApprovalRequestPart
  | ApprovalResultPart;
