/**
 * Tool runtime types for OpenSlate.
 *
 * Each tool has typed input/output contracts, a capability tag for permission
 * gating, and can emit structured activity metadata for Episodes/UI cards.
 */

// ── Capabilities ─────────────────────────────────────────────────────

export type ToolCapability = "read" | "write" | "search" | "shell" | "git";

// ── Schemas & Activity Contracts ─────────────────────────────────────

export type ToolSchema = Record<string, unknown>;

export interface ToolActivity {
  /** Stable activity type for UI bucketing (file_read, git_diff, etc). */
  type: string;
  /** Human-readable one-line summary. */
  summary: string;
  /** Optional primary target (path, repo, command). */
  target?: string;
  /** Optional count for list-like operations. */
  itemCount?: number;
}

// ── Tool Definition ──────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for tool parameters. */
  parameters: ToolSchema;
  /** JSON Schema describing structured output shape. */
  returns: ToolSchema;
  /** Capability category for permission scoping. */
  capability: ToolCapability;
}

// ── Tool Execution ───────────────────────────────────────────────────

export interface ToolExecutionOutput {
  content: string;
  data?: unknown;
  activity?: ToolActivity;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  durationMs: number;
  data?: unknown;
  activity?: ToolActivity;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// ── Tool Registry ────────────────────────────────────────────────────

export interface ToolExecutor {
  (args: Record<string, unknown>): Promise<string | ToolExecutionOutput>;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

export interface ToolRegistry {
  register(tool: RegisteredTool): void;
  get(name: string): RegisteredTool | undefined;
  list(): RegisteredTool[];
  listForCapabilities(capabilities: ToolCapability[]): RegisteredTool[];
  /** Get AI SDK-compatible tool definitions for a set of capabilities. */
  getToolSet(capabilities: ToolCapability[]): Record<string, { description: string; parameters: ToolSchema; returns: ToolSchema }>;
  /** Execute a tool call with permission checking. */
  execute(call: ToolCall, allowedCapabilities: ToolCapability[]): Promise<ToolResult>;
}