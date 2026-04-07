/**
 * @openslate/tools
 *
 * Minimal tool runtime for OpenSlate child threads.
 * Provides tool registration, capability-based permission gating,
 * and built-in tools for bounded coding work.
 */

export type {
  ToolCapability,
  ToolDefinition,
  ToolResult,
  ToolCall,
  ToolExecutor,
  RegisteredTool,
  ToolRegistry,
} from "./types.js";

export { createToolRegistry } from "./registry.js";

export {
  registerBuiltinTools,
  BUILTIN_TOOLS,
  readFileTool,
  globFilesTool,
  grepContentTool,
  writeFileTool,
  applyPatchTool,
  shellTool,
} from "./builtins.js";
