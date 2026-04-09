/**
 * Built-in tools for OpenSlate child threads.
 *
 * Minimum set required for bounded coding work:
 * - read_file, glob_files, grep_content (read/search)
 * - write_file, apply_patch (write)
 * - shell (shell)
 * - list_directory, stat_path (filesystem metadata)
 * - git_status, git_diff, git_log (git)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { RegisteredTool, ToolActivity, ToolRegistry, ToolSchema } from "./types.js";

function requiredStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid or missing '${key}' argument`);
  }
  return value;
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const activitySchema: ToolSchema = {
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

function returnsSchema(data: ToolSchema): ToolSchema {
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

function createActivity(type: string, summary: string, target?: string, itemCount?: number): ToolActivity {
  return { type, summary, target, itemCount };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        totalLines: { type: "number" },
      },
      required: ["path", "startLine", "endLine", "totalLines"],
      additionalProperties: false,
    }),
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

    return {
      content: `${header}\n${slice.join("\n")}`,
      data: {
        path: filePath,
        startLine: start + 1,
        endLine: end,
        totalLines: lines.length,
      },
      activity: createActivity("file_read", `Read ${end - start} lines`, filePath, end - start),
    };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        cwd: { type: "string" },
        pattern: { type: "string" },
        count: { type: "number" },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["cwd", "pattern", "count", "paths"],
      additionalProperties: false,
    }),
    capability: "read",
  },
  async execute(args) {
    const pattern = requiredStringArg(args, "pattern");
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();

    const glob = new Bun.Glob(pattern);
    const results: string[] = [];
    for await (const path of glob.scan({ cwd, onlyFiles: true })) {
      results.push(path);
      if (results.length >= 500) break;
    }

    return {
      content: results.length > 0
        ? `Found ${results.length} files:\n${results.join("\n")}`
        : "No files matched the pattern.",
      data: {
        cwd,
        pattern,
        count: results.length,
        paths: results,
      },
      activity: createActivity("glob_files", `Matched ${results.length} files`, cwd, results.length),
    };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        include: { type: "string" },
        count: { type: "number" },
        matches: { type: "array", items: { type: "string" } },
      },
      required: ["pattern", "path", "count", "matches"],
      additionalProperties: false,
    }),
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

      const lines = output.length > 0 ? output.split("\n") : [];
      const preview = lines.slice(0, 100);
      const content = lines.length > 100
        ? `Found ${lines.length} matches (showing first 100):\n${preview.join("\n")}\n... and ${lines.length - 100} more`
        : `Found ${lines.length} matches:\n${output}`;

      return {
        content,
        data: {
          pattern,
          path: searchPath,
          include,
          count: lines.length,
          matches: preview,
        },
        activity: createActivity("grep_content", `Found ${lines.length} matches`, searchPath, lines.length),
      };
    } catch (err: any) {
      if (err.status === 1) {
        return {
          content: "No matches found.",
          data: {
            pattern,
            path: searchPath,
            include,
            count: 0,
            matches: [],
          },
          activity: createActivity("grep_content", "Found 0 matches", searchPath, 0),
        };
      }
      throw new Error(`grep failed: ${err.message}`);
    }
  },
};

// ── list_directory ───────────────────────────────────────────────────

export const listDirectoryTool: RegisteredTool = {
  definition: {
    name: "list_directory",
    description: "List files and directories in a path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
        recursive: { type: "boolean", description: "Whether to recurse into subdirectories" },
        maxEntries: { type: "number", description: "Maximum number of entries to return (default 200)" },
      },
      required: ["path"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        count: { type: "number" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              type: { type: "string", enum: ["file", "directory"] },
              size: { type: "number" },
            },
            required: ["path", "type", "size"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "recursive", "count", "entries"],
      additionalProperties: false,
    }),
    capability: "read",
  },
  async execute(args) {
    const targetPath = requiredStringArg(args, "path");
    const recursive = args.recursive === true;
    const maxEntries = typeof args.maxEntries === "number" ? Math.max(1, args.maxEntries) : 200;

    if (!existsSync(targetPath)) {
      throw new Error(`Path not found: ${targetPath}`);
    }

    const rootStats = statSync(targetPath);
    if (!rootStats.isDirectory()) {
      throw new Error(`Path is not a directory: ${targetPath}`);
    }

    const entries: Array<{ path: string; type: "file" | "directory"; size: number }> = [];
    const queue: string[] = [targetPath];

    while (queue.length > 0 && entries.length < maxEntries) {
      const current = queue.shift()!;
      const dirEntries = readdirSync(current, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entries.length >= maxEntries) break;

        const absolute = join(current, entry.name);
        const stats = statSync(absolute);
        const type = entry.isDirectory() ? "directory" : "file";

        entries.push({ path: absolute, type, size: stats.size });
        if (recursive && entry.isDirectory()) {
          queue.push(absolute);
        }
      }
    }

    const content = entries.length > 0
      ? `Found ${entries.length} entries in ${targetPath}:\n${entries.map((e) => `${e.type}\t${e.path}`).join("\n")}`
      : `No entries found in ${targetPath}`;

    return {
      content,
      data: {
        path: targetPath,
        recursive,
        count: entries.length,
        entries,
      },
      activity: createActivity("list_directory", `Listed ${entries.length} entries`, targetPath, entries.length),
    };
  },
};

// ── stat_path ────────────────────────────────────────────────────────

export const statPathTool: RegisteredTool = {
  definition: {
    name: "stat_path",
    description: "Return metadata for a file or directory path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to inspect" },
      },
      required: ["path"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        exists: { type: "boolean" },
        type: { type: "string", enum: ["file", "directory", "other", "missing"] },
        size: { type: "number" },
        mtimeMs: { type: "number" },
      },
      required: ["path", "exists", "type"],
      additionalProperties: false,
    }),
    capability: "read",
  },
  async execute(args) {
    const targetPath = requiredStringArg(args, "path");
    if (!existsSync(targetPath)) {
      return {
        content: `Path does not exist: ${targetPath}`,
        data: {
          path: targetPath,
          exists: false,
          type: "missing",
        },
        activity: createActivity("stat_path", "Inspected missing path", targetPath),
      };
    }

    const stats = statSync(targetPath);
    const type = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other";

    return {
      content: `${targetPath}\nType: ${type}\nSize: ${stats.size} bytes\nModified: ${new Date(stats.mtimeMs).toISOString()}`,
      data: {
        path: targetPath,
        exists: true,
        type,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      },
      activity: createActivity("stat_path", `Inspected ${type}`, targetPath),
    };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        lineCount: { type: "number" },
      },
      required: ["path", "lineCount"],
      additionalProperties: false,
    }),
    capability: "write",
  },
  async execute(args) {
    const filePath = requiredStringArg(args, "path");
    const content = requiredStringArg(args, "content");

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    const lineCount = content.split("\n").length;

    return {
      content: `Wrote ${lineCount} lines to ${filePath}`,
      data: {
        path: filePath,
        lineCount,
      },
      activity: createActivity("file_write", `Wrote ${lineCount} lines`, filePath, lineCount),
    };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        applied: { type: "boolean" },
      },
      required: ["path", "applied"],
      additionalProperties: false,
    }),
    capability: "write",
  },
  async execute(args) {
    const filePath = requiredStringArg(args, "path");
    const patch = requiredStringArg(args, "patch");

    try {
      const tmpDir = mkdtempSync(join(tmpdir(), "openslate-patch-"));
      const patchFile = join(tmpDir, "patch.diff");
      writeFileSync(patchFile, patch, "utf-8");
      execSync(`patch "${filePath}" "${patchFile}"`, { encoding: "utf-8", timeout: 10000 });
      rmSync(tmpDir, { recursive: true, force: true });

      return {
        content: `Patch applied to ${filePath}`,
        data: {
          path: filePath,
          applied: true,
        },
        activity: createActivity("apply_patch", "Applied unified diff", filePath),
      };
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
    returns: returnsSchema({
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout: { type: "number" },
      },
      required: ["command", "cwd", "timeout"],
      additionalProperties: false,
    }),
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
      const content = trimmed.length > 10000
        ? `${trimmed.slice(0, 10000)}\n... (output truncated)`
        : trimmed || "(no output)";

      return {
        content,
        data: {
          command,
          cwd,
          timeout,
        },
        activity: createActivity("shell", `Executed command: ${command}`, cwd),
      };
    } catch (err: any) {
      const stderr = err.stderr ? String(err.stderr).trim() : "";
      const stdout = err.stdout ? String(err.stdout).trim() : "";
      throw new Error(`Command failed (exit ${err.status}): ${stderr || stdout || err.message}`);
    }
  },
};

// ── git_status ───────────────────────────────────────────────────────

export const gitStatusTool: RegisteredTool = {
  definition: {
    name: "git_status",
    description: "Show repository status in porcelain format.",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository root (defaults to process.cwd())" },
      },
      required: [],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        cwd: { type: "string" },
        entries: { type: "array", items: { type: "string" } },
        count: { type: "number" },
      },
      required: ["cwd", "entries", "count"],
      additionalProperties: false,
    }),
    capability: "git",
  },
  async execute(args) {
    const cwd = optionalStringArg(args, "cwd") ?? process.cwd();
    const output = execSync("git status --short --branch", {
      encoding: "utf-8",
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    }).trim();

    const entries = output.length === 0 ? [] : output.split("\n");
    return {
      content: output || "Working tree clean.",
      data: {
        cwd,
        entries,
        count: entries.length,
      },
      activity: createActivity("git_status", `git status returned ${entries.length} lines`, cwd, entries.length),
    };
  },
};

// ── git_diff ─────────────────────────────────────────────────────────

export const gitDiffTool: RegisteredTool = {
  definition: {
    name: "git_diff",
    description: "Show git diff for working tree or staged changes.",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository root (defaults to process.cwd())" },
        target: { type: "string", description: "Optional file/pathspec to diff" },
        staged: { type: "boolean", description: "Show staged diff (--staged)" },
        contextLines: { type: "number", description: "Context lines (default 3)" },
      },
      required: [],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        cwd: { type: "string" },
        target: { type: "string" },
        staged: { type: "boolean" },
        contextLines: { type: "number" },
        lineCount: { type: "number" },
      },
      required: ["cwd", "staged", "contextLines", "lineCount"],
      additionalProperties: false,
    }),
    capability: "git",
  },
  async execute(args) {
    const cwd = optionalStringArg(args, "cwd") ?? process.cwd();
    const target = optionalStringArg(args, "target");
    const staged = args.staged === true;
    const contextLines = typeof args.contextLines === "number" ? Math.max(0, args.contextLines) : 3;

    const parts = ["git", "diff", "--no-color", `-U${contextLines}`];
    if (staged) parts.push("--staged");
    if (target) parts.push("--", target);

    const output = execSync(parts.join(" "), {
      encoding: "utf-8",
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10000,
    }).trim();

    const lines = output.length === 0 ? [] : output.split("\n");
    return {
      content: output || "No diff.",
      data: {
        cwd,
        target,
        staged,
        contextLines,
        lineCount: lines.length,
      },
      activity: createActivity("git_diff", `git diff returned ${lines.length} lines`, target ?? cwd, lines.length),
    };
  },
};

// ── git_log ──────────────────────────────────────────────────────────

export const gitLogTool: RegisteredTool = {
  definition: {
    name: "git_log",
    description: "Show recent commit history.",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository root (defaults to process.cwd())" },
        limit: { type: "number", description: "Number of commits (default 20, max 200)" },
      },
      required: [],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        cwd: { type: "string" },
        limit: { type: "number" },
        entries: { type: "array", items: { type: "string" } },
        count: { type: "number" },
      },
      required: ["cwd", "limit", "entries", "count"],
      additionalProperties: false,
    }),
    capability: "git",
  },
  async execute(args) {
    const cwd = optionalStringArg(args, "cwd") ?? process.cwd();
    const limitRaw = typeof args.limit === "number" ? args.limit : 20;
    const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));

    const output = execSync(`git log --oneline -n ${limit}`, {
      encoding: "utf-8",
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    }).trim();

    const entries = output.length === 0 ? [] : output.split("\n");
    return {
      content: output || "No commits found.",
      data: {
        cwd,
        limit,
        entries,
        count: entries.length,
      },
      activity: createActivity("git_log", `Fetched ${entries.length} commits`, cwd, entries.length),
    };
  },
};

// ── Register All ─────────────────────────────────────────────────────

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(globFilesTool);
  registry.register(grepContentTool);
  registry.register(listDirectoryTool);
  registry.register(statPathTool);
  registry.register(writeFileTool);
  registry.register(applyPatchTool);
  registry.register(shellTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
}

export const BUILTIN_TOOLS = [
  readFileTool,
  globFilesTool,
  grepContentTool,
  listDirectoryTool,
  statPathTool,
  writeFileTool,
  applyPatchTool,
  shellTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
];
