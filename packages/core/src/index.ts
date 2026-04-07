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
export { createWorkerReturnStore } from "./storage/index.js";
export type { WorkerReturnStore, CreateWorkerReturnInput } from "./storage/index.js";

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
  ThreadCreatedEvent,
  ThreadReusedEvent,
  ThreadStartedEvent,
  ThreadCompletedEvent,
  ThreadFailedEvent,
  WorkerReturnCreatedEvent,
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

export { createModelCallAdapter, createChildModelCallAdapter } from "./model-adapter.js";
export type { CompleteFn, ChildCompleteFn } from "./model-adapter.js";

// ── Child Runtime ────────────────────────────────────────────────────

export { runChildLoop } from "./child-runtime.js";
export type {
  ChildToolCall,
  ChildToolResult,
  ChildModelCallInput,
  ChildModelCallResult,
  ChildModelCallFn,
  ToolExecutorFn,
  ChildRuntimeConfig,
  ChildRuntimeDeps,
  ChildRunResult,
} from "./child-runtime.js";

// ── Thread Service ───────────────────────────────────────────────────

export { createThreadService } from "./thread-service.js";
export type {
  SpawnThreadInput,
  SpawnThreadResult,
  ThreadService,
  ThreadServiceDeps,
} from "./thread-service.js";

