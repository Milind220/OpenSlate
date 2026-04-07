/**
 * @openslate/core
 *
 * Core runtime types, storage, services, and events for OpenSlate.
 * Provider-agnostic — no model or provider specifics leak here.
 */

// ── Types ────────────────────────────────────────────────────────────

export type {
  SessionId,
  ProjectId,
  MessageId,
  ArtifactId,
  SessionKind,
  SessionStatus,
  Session,
  ThreadSession,
  QuerySession,
} from "./types/index.js";

export type {
  MessageRole,
  Message,
  MessagePartKind,
  MessagePartBase,
  TextPart,
  ReasoningPart,
  ToolCallPart,
  ToolResultPart,
  SnapshotPart,
  PatchPart,
  AgentPart,
  StatusPart,
  HandoffPart,
  SummaryMarkerPart,
  WorkerReturnRefPart,
  ApprovalRequestPart,
  ApprovalResultPart,
  MessagePart,
} from "./types/index.js";

export type {
  ArtifactKind,
  Artifact,
} from "./types/index.js";

export type {
  HandoffKind,
  HandoffState,
} from "./types/index.js";

export type {
  WorkerReturnStatus,
  ChildType,
  WorkerReturn,
} from "./types/index.js";

// ── Storage ──────────────────────────────────────────────────────────

export { initDatabase } from "./storage/index.js";
export { createSessionStore } from "./storage/index.js";
export type { SessionStore, CreateSessionInput } from "./storage/index.js";
export { createMessageStore } from "./storage/index.js";
export type { MessageStore, AppendMessageInput } from "./storage/index.js";

// ── Events ───────────────────────────────────────────────────────────

export { createEventBus, RuntimeEvents } from "./events.js";
export type {
  RuntimeEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  MessageCreatedEvent,
  AssistantStartedEvent,
  AssistantCompletedEvent,
  AssistantFailedEvent,
  OpenSlateEvent,
  OpenSlateEventType,
  EventListener,
  EventBus,
} from "./events.js";

// ── Session Service ──────────────────────────────────────────────────

export { createSessionService } from "./session-service.js";
export type {
  ModelCallInput,
  ModelCallResult,
  ModelCallFn,
  SendMessageResult,
  SessionService,
  SessionServiceDeps,
} from "./session-service.js";

// ── Model Adapter ────────────────────────────────────────────────────

export { createModelCallAdapter } from "./model-adapter.js";
export type { CompleteFn } from "./model-adapter.js";
