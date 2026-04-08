/**
 * Built-in tools for OpenSlate child threads.
 *
 * Minimum set required for bounded coding work:
 * - read_file, glob_files, grep_content (read/search)
 * - write_file, apply_patch (write)
 * - shell (shell)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { RegisteredTool } from "./types.js";

function requiredStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing '${key}' argument`);
  }
  return value;
}

// ── read_file ────────────────────────────────────────────────────────

export const readFileTool: RegisteredTool = {
  definition: {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content as a string.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        startLine: { type: "number", description: "Optional 1-based start line" },
        endLine: { type: "number", description: "Optional 1-based end line" },
      },
      required: ["path"],
    },
    capability: "read",
  },
  async execute(args) {
    const filePath = requiredStringArg(args, "path");
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = typeof args.startLine === "number" ? Math.max(1, args.startLine) - 1 : 0;
    const end = typeof args.endLine === "number" ? Math.min(lines.length, args.endLine) : lines.length;
    const slice = lines.slice(start, end);
    const header = `[${filePath}] lines ${start + 1}-${end} of ${lines.length}`;
    return `${header}\n${slice.join("\n")}`;
  },
};

// ── glob_files ───────────────────────────────────────────────────────

export const globFilesTool: RegisteredTool = {
  definition: {
    name: "glob_files",
    description: "List files matching a glob pattern in a directory. Returns file paths.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts')" },
        cwd: { type: "string", description: "Working directory for the glob. Defaults to process.cwd()." },
      },
      required: ["pattern"],
    },
    capability: "read",
  },
  async execute(args) {
    const pattern = requiredStringArg(args, "pattern");
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
    // Use Bun's built-in Glob
    const glob = new Bun.Glob(pattern);
    const results: string[] = [];
    for await (const path of glob.scan({ cwd, onlyFiles: true })) {
      results.push(path);
      if (results.length >= 500) break; // Safety limit
    }
    return results.length > 0
      ? `Found ${results.length} files:\n${results.join("\n")}`
      : "No files matched the pattern.";
  },
};

// ── grep_content ─────────────────────────────────────────────────────

export const grepContentTool: RegisteredTool = {
  definition: {
    name: "grep_content",
    description: "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex supported)" },
        path: { type: "string", description: "File or directory to search in" },
        include: { type: "string", description: "File glob pattern to include (e.g., '*.ts')" },
      },
      required: ["pattern", "path"],
    },
    capability: "search",
  },
  async execute(args) {
    const pattern = requiredStringArg(args, "pattern");
    const searchPath = requiredStringArg(args, "path");
    const include = typeof args.include === "string" ? args.include : "";

    try {
      let cmd = `grep -rn "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
      if (include) {
        cmd = `grep -rn --include="${include}" "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
      }
      const output = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      }).trim();
      const lines = output.split("\n");
      if (lines.length > 100) {
        return `Found ${lines.length} matches (showing first 100):\n${lines.slice(0, 100).join("\n")}\n... and ${lines.length - 100} more`;
      }
      return `Found ${lines.length} matches:\n${output}`;
    } catch (err: any) {
      if (err.status === 1) return "No matches found.";
      throw new Error(`grep failed: ${err.message}`);
    }
  },
};

// ── write_file ───────────────────────────────────────────────────────

export const writeFileTool: RegisteredTool = {
  definition: {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    capability: "write",
  },
  async execute(args) {
    const filePath = requiredStringArg(args, "path");
    const content = requiredStringArg(args, "content");
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return `Wrote ${content.split("\n").length} lines to ${filePath}`;
  },
};

// ── apply_patch ──────────────────────────────────────────────────────

export const applyPatchTool: RegisteredTool = {
  definition: {
    name: "apply_patch",
    description: "Apply a unified diff patch to a file. The patch should be in standard unified diff format.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to patch" },
        patch: { type: "string", description: "Unified diff patch content" },
      },
      required: ["path", "patch"],
    },
    capability: "write",
  },
  async execute(args) {
    const filePath = requiredStringArg(args, "path");
    const patch = requiredStringArg(args, "patch");
    // Simple line-level patch application
    // For now, use the patch command if available
    try {
      const { writeFileSync: ws, mkdtempSync, rmSync } = await import("node:fs");
      const { join: j } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const tmpDir = mkdtempSync(j(tmpdir(), "openslate-patch-"));
      const patchFile = j(tmpDir, "patch.diff");
      ws(patchFile, patch, "utf-8");
      execSync(`patch "${filePath}" "${patchFile}"`, { encoding: "utf-8", timeout: 10000 });
      rmSync(tmpDir, { recursive: true });
      return `Patch applied to ${filePath}`;
    } catch (err: any) {
      throw new Error(`Patch failed: ${err.message}`);
    }
  },
};

// ── shell ────────────────────────────────────────────────────────────

export const shellTool: RegisteredTool = {
  definition: {
    name: "shell",
    description: "Execute a shell command and return the output. Use for git, build tools, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory. Defaults to process.cwd()." },
        timeout: { type: "number", description: "Timeout in ms. Default 30000." },
      },
      required: ["command"],
    },
    capability: "shell",
  },
  async execute(args) {
    const command = requiredStringArg(args, "command");
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
    const timeout = typeof args.timeout === "number" ? args.timeout : 30000;
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        cwd,
        maxBuffer: 2 * 1024 * 1024,
        timeout,
      });
      const trimmed = output.trim();
      if (trimmed.length > 10000) {
        return trimmed.slice(0, 10000) + "\n... (output truncated)";
      }
      return trimmed || "(no output)";
    } catch (err: any) {
      const stderr = err.stderr ? String(err.stderr).trim() : "";
      const stdout = err.stdout ? String(err.stdout).trim() : "";
      throw new Error(`Command failed (exit ${err.status}): ${stderr || stdout || err.message}`);
    }
  },
};

// ── Register All ─────────────────────────────────────────────────────

import type { ToolRegistry } from "./types.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(globFilesTool);
  registry.register(grepContentTool);
  registry.register(writeFileTool);
  registry.register(applyPatchTool);
  registry.register(shellTool);
}

export const BUILTIN_TOOLS = [
  readFileTool,
  globFilesTool,
  grepContentTool,
  writeFileTool,
  applyPatchTool,
  shellTool,
];
