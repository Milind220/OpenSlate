/**
 * Provider-portable model abstraction types.
 *
 * Design rules:
 * - Provider choice is orthogonal to session/orchestrator logic
 * - Role-based model routing is first-class
 * - Provider-specific quirks are normalized behind adapters
 * - Per-role model selection works across providers
 */

// ── Model Slots ──────────────────────────────────────────────────────

/**
 * Role-based model slots.
 * Each slot represents a runtime role that can be assigned to a different model/provider.
 */
export type ModelSlot =
  | "primary"    // strategic orchestration
  | "execute"    // code and tool-heavy work
  | "explore"    // research/query tasks
  | "search"     // web research and lightweight retrieval
  | "compress"   // summarization/compaction
  | "title"      // session title generation (optional)
  | "classify";  // classification/routing decisions (optional)

/** Configuration for a single model slot. */
export interface ModelSlotConfig {
  provider: string;
  model: string;
  /** Optional temperature override for this slot. */
  temperature?: number;
  /** Optional max tokens override for this slot. */
  maxTokens?: number;
}

/** Full router configuration mapping slots to provider/model pairs. */
export interface ModelRouterConfig {
  /** Required slots. */
  primary: ModelSlotConfig;
  execute: ModelSlotConfig;
  explore: ModelSlotConfig;
  search: ModelSlotConfig;
  compress: ModelSlotConfig;
  /** Optional slots — fall back to primary if not configured. */
  title?: ModelSlotConfig;
  classify?: ModelSlotConfig;
}

// ── Provider Config ──────────────────────────────────────────────────

/** Configuration for a single provider backend. */
export interface ProviderConfig {
  id: string;
  kind: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** Provider-specific options (e.g., organization ID). */
  options?: Record<string, unknown>;
}

// ── Normalized Request/Response ──────────────────────────────────────

export interface ModelMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ModelMessagePart[];
  toolCallId?: string;
  name?: string;
}

export type ModelMessagePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: string }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface ToolDefinitionParam {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Normalized model request — provider-agnostic. */
export interface ModelRequest {
  messages: ModelMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinitionParam[];
  /** Request JSON mode / structured output. */
  jsonMode?: boolean;
  /** Request streaming. */
  stream?: boolean;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** Normalized model response — provider-agnostic. */
export interface ModelResponse {
  content: string | null;
  toolCalls: ModelToolCall[];
  reasoning: string | null;
  usage: ModelUsage;
  finishReason: "stop" | "tool_calls" | "length" | "error";
  /** Raw provider response for debugging. */
  raw?: unknown;
}

export interface ModelToolCall {
  id: string;
  name: string;
  args: string;
}

// ── Usage / Cost ─────────────────────────────────────────────────────

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cost in USD, if calculable. */
  costUsd?: number;
}

// ── Streaming ────────────────────────────────────────────────────────

export type StreamEventKind =
  | "text_delta"
  | "reasoning_delta"
  | "tool_call_start"
  | "tool_call_delta"
  | "tool_call_end"
  | "done"
  | "error";

export interface StreamEvent {
  kind: StreamEventKind;
  /** Text content delta. */
  delta?: string;
  /** Tool call metadata for tool_call_start events. */
  toolCall?: { id: string; name: string };
  /** Final usage stats on done event. */
  usage?: ModelUsage;
  /** Error info on error event. */
  error?: string;
}

// ── Provider Interface ───────────────────────────────────────────────

/**
 * ModelProvider — raw provider call interface.
 * One per configured provider backend.
 */
export interface ModelProvider {
  readonly id: string;
  readonly kind: string;

  /** Make a non-streaming completion call. */
  complete(request: ModelRequest): Promise<ModelResponse>;

  /** Make a streaming completion call. */
  stream(request: ModelRequest): AsyncIterable<StreamEvent>;
}

/**
 * ModelAdapter — normalizes provider quirks.
 * Wraps a ModelProvider to handle tool call format differences,
 * streaming event normalization, usage accounting, etc.
 */
export interface ModelAdapter {
  readonly providerId: string;

  /** Normalized completion call. */
  complete(request: ModelRequest): Promise<ModelResponse>;

  /** Normalized streaming call. */
  stream(request: ModelRequest): AsyncIterable<StreamEvent>;
}
