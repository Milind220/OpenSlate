/**
 * Tool runtime types for OpenSlate.
 *
 * Each tool has typed input/output contracts, a capability tag for permission
 * gating, and can emit structured activity metadata for Episodes/UI cards.
 */

// ── Capabilities ─────────────────────────────────────────────────────

export type ToolCapability =
  | "read"      // File reading operations
  | "write"     // File writing operations
  | "edit"      // File editing operations
  | "search"    // Content searching
  | "shell"     // Shell command execution
  | "web"       // Web fetching and searching
  | "agent"     // Subagent spawning and task management
  | "lsp"       // Language server protocol operations
  | "skill"     // Skill loading
  | "batch";    // Batch operations

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

// ── Helper Types ─────────────────────────────────────────────────────

export function requiredStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing '${key}' argument`);
  }
  return value;
}

export function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}

export function optionalBooleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

// ── Activity Helpers ─────────────────────────────────────────────────

export const activitySchema: ToolSchema = {
  type: "object",
  properties: {
    type: { type: "string" },
    summary: { type: "string" },
    target: { type: "string" },
    itemCount: { type: "number" },
  },
  required: ["type", "summary"],
  additionalProperties: true,
};

export function returnsSchema(data: ToolSchema): ToolSchema {
  return {
    type: "object",
    properties: {
      content: { type: "string" },
      data,
      activity: activitySchema,
    },
    required: ["content"],
    additionalProperties: false,
  };
}

export function createActivity(type: string, summary: string, target?: string, itemCount?: number): ToolActivity {
  return { type, summary, target, itemCount };
}
