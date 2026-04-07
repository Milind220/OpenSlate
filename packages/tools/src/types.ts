/**
 * Tool runtime types for OpenSlate.
 *
 * Each tool has typed input/output, a capability tag for permission gating,
 * and produces structured results.
 */

// ── Capabilities ─────────────────────────────────────────────────────

export type ToolCapability = "read" | "write" | "search" | "shell";

// ── Tool Definition ──────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for tool parameters. */
  parameters: Record<string, unknown>;
  /** Capability category for permission scoping. */
  capability: ToolCapability;
}

// ── Tool Execution ───────────────────────────────────────────────────

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
  durationMs: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// ── Tool Registry ────────────────────────────────────────────────────

export interface ToolExecutor {
  (args: Record<string, unknown>): Promise<string>;
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
  getToolSet(capabilities: ToolCapability[]): Record<string, { description: string; parameters: Record<string, unknown> }>;
  /** Execute a tool call with permission checking. */
  execute(call: ToolCall, allowedCapabilities: ToolCapability[]): Promise<ToolResult>;
}
