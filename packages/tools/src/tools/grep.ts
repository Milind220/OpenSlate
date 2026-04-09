/**
 * Grep tool - searches file contents using regex patterns.
 * Based on OpenCode's grep.ts implementation using ripgrep.
 */

import { spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { statSync, existsSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalStringArg, returnsSchema } from "../types.js";

const MAX_LINE_LENGTH = 2000;

async function execRipgrep(
  pattern: string,
  searchPath: string,
  include?: string,
): Promise<{ output: string; exitCode: number; hasErrors: boolean }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-nH",
      "--hidden",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      pattern,
    ];

    if (include) {
      args.push("--glob", include);
    }

    args.push(searchPath);

    const proc = spawn("rg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      // Exit codes: 0 = matches found, 1 = no matches, 2 = errors
      const hasErrors = code === 2 && stderr.length > 0;
      resolve({
        output: stdout,
        exitCode: code ?? 0,
        hasErrors,
      });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

export const grepTool: RegisteredTool = {
  definition: {
    name: "grep",
    description: `Fast content search tool that works with any codebase size.

Usage:
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with rg (ripgrep) directly. Do NOT use grep.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for in file contents",
        },
        path: {
          type: "string",
          description: "The directory to search in. Defaults to the current working directory.",
        },
        include: {
          type: "string",
          description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
        },
      },
      required: ["pattern"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        include: { type: "string" },
        matches: { type: "number" },
        truncated: { type: "boolean" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              lineNum: { type: "number" },
              lineText: { type: "string" },
            },
            required: ["path", "lineNum", "lineText"],
          },
        },
      },
      required: ["pattern", "path", "matches", "truncated"],
      additionalProperties: false,
    }),
    capability: "search",
  },

  async execute(args) {
    const pattern = requiredStringArg(args, "pattern");
    let searchPath = optionalStringArg(args, "path") ?? process.cwd();
    const include = optionalStringArg(args, "include");

    // Ensure absolute path
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(process.cwd(), searchPath);
    }

    if (!existsSync(searchPath)) {
      throw new Error(`Path not found: ${searchPath}`);
    }

    try {
      const { output, exitCode, hasErrors } = await execRipgrep(pattern, searchPath, include);

      // Exit code 1 means no matches found
      if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
        return {
          content: "No matches found.",
          data: {
            pattern,
            path: searchPath,
            include: include ?? "",
            matches: 0,
            truncated: false,
            results: [],
          },
          activity: createActivity("grep_search", "Found 0 matches", searchPath, 0),
        };
      }

      if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
        throw new Error(`ripgrep failed with exit code ${exitCode}`);
      }

      // Handle both Unix (\n) and Windows (\r\n) line endings
      const lines = output.trim().split(/\r?\n/);
      const matches: Array<{ path: string; lineNum: number; lineText: string; modTime: number }> = [];

      for (const line of lines) {
        if (!line) continue;

        const [filePath, lineNumStr, ...lineTextParts] = line.split("|");
        if (!filePath || !lineNumStr || lineTextParts.length === 0) continue;

        const lineNum = parseInt(lineNumStr, 10);
        const lineText = lineTextParts.join("|");

        // Get file modification time
        let modTime = 0;
        try {
          modTime = statSync(filePath).mtime.getTime();
        } catch {
          // File might have been deleted
          continue;
        }

        matches.push({ path: filePath, lineNum, lineText, modTime });
      }

      // Sort by modification time (most recent first)
      matches.sort((a, b) => b.modTime - a.modTime);

      const limit = 100;
      const truncated = matches.length > limit;
      const finalMatches = truncated ? matches.slice(0, limit) : matches;

      if (finalMatches.length === 0) {
        return {
          content: "No matches found.",
          data: {
            pattern,
            path: searchPath,
            include: include ?? "",
            matches: 0,
            truncated: false,
            results: [],
          },
          activity: createActivity("grep_search", "Found 0 matches", searchPath, 0),
        };
      }

      const totalMatches = matches.length;
      const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`];

      let currentFile = "";
      for (const match of finalMatches) {
        if (currentFile !== match.path) {
          if (currentFile !== "") {
            outputLines.push("");
          }
          currentFile = match.path;
          outputLines.push(`${match.path}:`);
        }
        const truncatedLineText =
          match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText;
        outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`);
      }

      if (truncated) {
        outputLines.push("");
        outputLines.push(
          `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
        );
      }

      if (hasErrors) {
        outputLines.push("");
        outputLines.push("(Some paths were inaccessible and skipped)");
      }

      return {
        content: outputLines.join("\n"),
        data: {
          pattern,
          path: searchPath,
          include: include ?? "",
          matches: totalMatches,
          truncated,
          results: finalMatches.map((m) => ({ path: m.path, lineNum: m.lineNum, lineText: m.lineText })),
        },
        activity: createActivity("grep_search", `Found ${totalMatches} matches`, searchPath, totalMatches),
      };
    } catch (error) {
      // Fallback to simple grep if ripgrep is not available
      return fallbackGrep(pattern, searchPath, include);
    }
  },
};

async function fallbackGrep(
  pattern: string,
  searchPath: string,
  include?: string,
): Promise<{
  content: string;
  data: unknown;
  activity: ReturnType<typeof createActivity>;
}> {
  try {
    const { execSync } = await import("node:child_process");

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
    const content =
      lines.length > 100
        ? `Found ${lines.length} matches (showing first 100):\n${preview.join("\n")}\n... and ${lines.length - 100} more`
        : `Found ${lines.length} matches:\n${output}`;

    return {
      content,
      data: {
        pattern,
        path: searchPath,
        include: include ?? "",
        matches: lines.length,
        results: preview,
      },
      activity: createActivity("grep_search", `Found ${lines.length} matches`, searchPath, lines.length),
    };
  } catch (err: any) {
    if (err.status === 1) {
      return {
        content: "No matches found.",
        data: {
          pattern,
          path: searchPath,
          include: include ?? "",
          matches: 0,
          results: [],
        },
        activity: createActivity("grep_search", "Found 0 matches", searchPath, 0),
      };
    }
    throw new Error(`grep failed: ${err.message}`);
  }
}
