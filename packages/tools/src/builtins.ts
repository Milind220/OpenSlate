/**
 * Built-in tools for OpenSlate - based on OpenCode's tool set.
 *
 * This file provides a comprehensive set of tools matching OpenCode's capabilities:
 * - File Operations: read, write, edit, multiedit, apply_patch
 * - File Search: glob, grep, list
 * - Shell: bash
 * - Web: fetch, search, code
 * - Agent/Task: task, todo, ask
 * - Code Intelligence: skill, lsp
 * - Utilities: batch, invalid
 */

import type { ToolRegistry, RegisteredTool } from "./types.js";

// Import all tools
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";
import { editTool } from "./tools/edit.js";
import { multiEditTool } from "./tools/multiedit.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { listTool } from "./tools/ls.js";
import { bashTool } from "./tools/bash.js";
import { applyPatchTool } from "./tools/apply_patch.js";
import { fetchTool } from "./tools/fetch.js";
import { searchTool } from "./tools/search.js";
import { codeTool } from "./tools/code.js";
import { taskTool } from "./tools/task.js";
import { todoTool } from "./tools/todo.js";
import { askTool } from "./tools/ask.js";
import { skillTool } from "./tools/skill.js";
import { lspTool } from "./tools/lsp.js";
import { batchTool, setBatchRegistry } from "./tools/batch.js";
import { invalidTool } from "./tools/invalid.js";

// Export individual tools for direct access
export {
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  globTool,
  grepTool,
  listTool,
  bashTool,
  applyPatchTool,
  fetchTool,
  searchTool,
  codeTool,
  taskTool,
  todoTool,
  askTool,
  skillTool,
  lspTool,
  batchTool,
  invalidTool,
};

// Export all tools as an array
export const BUILTIN_TOOLS: RegisteredTool[] = [
  // File Operations
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  applyPatchTool,

  // File Search
  globTool,
  grepTool,
  listTool,

  // Shell
  bashTool,

  // Web
  fetchTool,
  searchTool,
  codeTool,

  // Agent/Task
  taskTool,
  todoTool,
  askTool,

  // Code Intelligence
  skillTool,
  lspTool,

  // Utilities
  batchTool,
  invalidTool,
];

/**
 * Register all built-in tools with the registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }

  // Set up batch tool registry reference
  setBatchRegistry(registry);
}

/**
 * Legacy tool exports for backwards compatibility.
 * These map to the new OpenCode-style tools.
 * @deprecated Use the new tool names directly
 */
export const legacyToolMap = {
  read_file: readTool,
  write_file: writeTool,
  apply_patch: applyPatchTool,
  glob_files: globTool,
  grep_content: grepTool,
  list_directory: listTool,
  shell: bashTool,
} as const;
