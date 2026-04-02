/**
 * Tool runtime types.
 *
 * Each tool has a typed schema, produces persisted results,
 * and respects permission gates.
 * Placeholder — tool implementations come in a later phase.
 */

/** Definition of a single tool available to the runtime. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for tool parameters. */
  parameters: Record<string, unknown>;
  /** Whether this tool requires explicit approval. */
  requiresApproval: boolean;
  /** Capability category for permission scoping. */
  capability: string;
}

/** Result of a tool execution. */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Permission policy for a tool or capability. */
export type ToolPermissionPolicy = "allow" | "deny" | "ask";

export interface ToolPermission {
  tool: string;
  policy: ToolPermissionPolicy;
}
