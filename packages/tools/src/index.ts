/**
 * @openslate/tools
 *
 * Comprehensive tool runtime for OpenSlate.
 * Based on OpenCode's tool architecture - provides 20+ tools for coding work.
 *
 * ## Tool Categories
 *
 * ### File Operations
 * - `read` - Read files and directories with offset/limit support
 * - `write` - Write/create files
 * - `edit` - Edit files with fuzzy matching algorithms
 * - `multiedit` - Apply multiple sequential edits to a single file
 * - `apply_patch` - Apply unified diff patches
 *
 * ### File Search
 * - `glob` - Find files matching glob patterns
 * - `grep` - Search file contents using regex (uses ripgrep)
 * - `list` - List directory contents with ignore patterns
 *
 * ### Shell
 * - `bash` - Execute shell commands with proper handling and safety measures
 *
 * ### Web
 * - `fetch` - Fetch web content from URLs (HTML/markdown/text)
 * - `search` - Web search via Exa AI
 * - `code` - Code/API documentation search via Exa AI
 *
 * ### Agent/Task
 * - `task` - Spawn subagent tasks
 * - `todo` - Manage session todo lists
 * - `ask` - Display interactive question dialogs to user
 *
 * ### Code Intelligence
 * - `skill` - Load specialized skills
 * - `lsp` - Language Server Protocol operations
 *
 * ### Utilities
 * - `batch` - Execute multiple tools in parallel
 * - `invalid` - Fallback handler for invalid tool calls
 */

// ── Types & Registry ──────────────────────────────────────────────────

export type {
  ToolCapability,
  ToolDefinition,
  ToolSchema,
  ToolActivity,
  ToolResult,
  ToolCall,
  ToolExecutor,
  RegisteredTool,
  ToolRegistry,
  ToolExecutionOutput,
} from "./types.js";

export {
  createActivity,
  returnsSchema,
  activitySchema,
  requiredStringArg,
  optionalStringArg,
  optionalNumberArg,
  optionalBooleanArg,
} from "./types.js";

export { createToolRegistry } from "./registry.js";

// ── Tool Registration ───────────────────────────────────────────────────

export {
  registerBuiltinTools,
  BUILTIN_TOOLS,
  legacyToolMap,
} from "./builtins.js";

// ── Individual Tools (File Operations) ────────────────────────────────────

export { readTool } from "./tools/read.js";
export { writeTool } from "./tools/write.js";
export { editTool } from "./tools/edit.js";
export { multiEditTool } from "./tools/multiedit.js";
export { applyPatchTool } from "./tools/apply_patch.js";

// ── Individual Tools (File Search) ────────────────────────────────────────

export { globTool } from "./tools/glob.js";
export { grepTool } from "./tools/grep.js";
export { listTool } from "./tools/ls.js";

// ── Individual Tools (Shell) ────────────────────────────────────────────

export { bashTool } from "./tools/bash.js";

// ── Individual Tools (Web) ────────────────────────────────────────────────

export { fetchTool } from "./tools/fetch.js";
export { searchTool } from "./tools/search.js";
export { codeTool } from "./tools/code.js";

// ── Individual Tools (Agent/Task) ───────────────────────────────────────

export { taskTool } from "./tools/task.js";
export { todoTool, type TodoItem, getSessionTodos } from "./tools/todo.js";
export { askTool, type Question, type Answer } from "./tools/ask.js";

// ── Individual Tools (Code Intelligence) ────────────────────────────────

export { skillTool, type Skill, discoverSkills, formatSkillList } from "./tools/skill.js";
export { lspTool } from "./tools/lsp.js";

// ── Individual Tools (Utilities) ─────────────────────────────────────────

export { batchTool, setBatchRegistry } from "./tools/batch.js";
export { invalidTool } from "./tools/invalid.js";

// ── Edit Tool Utilities ──────────────────────────────────────────────────

export {
  replace,
  detectLineEnding,
  normalizeLineEndings,
  convertToLineEnding,
} from "./tools/edit.js";
