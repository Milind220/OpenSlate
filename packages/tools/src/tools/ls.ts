/**
 * List (ls) tool - lists directory contents with ignore patterns.
 * Based on OpenCode's ls.ts implementation.
 */

import * as path from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, optionalStringArg, returnsSchema } from "../types.js";

export const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
];

const LIMIT = 100;

function shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  for (const pattern of ignorePatterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    if (normalizedPath.includes(normalizedPattern)) {
      return true;
    }
    // Check if file matches glob pattern
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + normalizedPattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
      );
      if (regex.test(normalizedPath) || regex.test(path.basename(normalizedPath))) {
        return true;
      }
    }
  }
  return false;
}

function listFilesRecursive(
  dirPath: string,
  ignorePatterns: string[],
  limit: number,
): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;

  function walk(currentPath: string, relativePath: string) {
    if (files.length >= limit) {
      truncated = true;
      return;
    }

    if (shouldIgnore(currentPath, ignorePatterns)) {
      return;
    }

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= limit) {
          truncated = true;
          return;
        }

        const fullPath = path.join(currentPath, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (shouldIgnore(fullPath, ignorePatterns)) {
          continue;
        }

        if (entry.isDirectory()) {
          files.push(relPath + "/");
          walk(fullPath, relPath);
        } else {
          files.push(relPath);
        }
      }
    } catch {
      // Permission denied or other error - skip this directory
    }
  }

  walk(dirPath, "");
  return { files, truncated };
}

export const listTool: RegisteredTool = {
  definition: {
    name: "list",
    description: `Lists files and directories in a directory path.

Usage:
- The path parameter should be an absolute path.
- Automatically ignores common directories like node_modules, .git, dist, build, etc.
- Returns directory entries with trailing / for subdirectories
- Results are limited to 100 entries`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The absolute path to the directory to list (must be absolute, not relative)",
        },
        ignore: {
          type: "array",
          items: { type: "string" },
          description: "List of glob patterns to ignore in addition to the default ignore patterns",
        },
      },
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        count: { type: "number" },
        truncated: { type: "boolean" },
        entries: { type: "array", items: { type: "string" } },
      },
      required: ["path", "count", "truncated", "entries"],
      additionalProperties: false,
    }),
    capability: "read",
  },

  async execute(args) {
    const dirPath = optionalStringArg(args, "path") ?? process.cwd();

    // Ensure absolute path
    let searchPath = dirPath;
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(process.cwd(), searchPath);
    }

    if (!existsSync(searchPath)) {
      throw new Error(`Path not found: ${searchPath}`);
    }

    const stats = statSync(searchPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${searchPath}`);
    }

    // Combine default ignore patterns with user-provided patterns
    const customIgnore = Array.isArray(args.ignore) ? args.ignore : [];
    const ignorePatterns = [...IGNORE_PATTERNS, ...customIgnore];

    const { files, truncated } = listFilesRecursive(searchPath, ignorePatterns, LIMIT);

    // Build output tree structure
    function buildTree(entries: string[]): string {
      const dirs = new Set<string>();
      const filesByDir = new Map<string, string[]>();

      for (const entry of entries) {
        const dir = path.dirname(entry) === "." ? "" : path.dirname(entry);
        const parts = dir === "" ? [] : dir.split("/");

        // Add all parent directories
        for (let i = 0; i <= parts.length; i++) {
          const dirPath = i === 0 ? "" : parts.slice(0, i).join("/");
          dirs.add(dirPath);
        }

        // Add file to its directory
        if (!filesByDir.has(dir)) {
          filesByDir.set(dir, []);
        }
        filesByDir.get(dir)!.push(entry);
      }

      function renderDir(dirPath: string, depth: number): string {
        const indent = "  ".repeat(depth);
        let output = "";

        if (depth > 0) {
          const baseName = dirPath === "" ? searchPath : path.basename(dirPath);
          output += `${indent}${baseName}/\n`;
        }

        const childIndent = "  ".repeat(depth + 1);

        // Get children (subdirectories)
        const children = Array.from(dirs)
          .filter((d) => {
            const parent = d === "" ? "" : path.dirname(d);
            return parent === dirPath && d !== dirPath;
          })
          .sort();

        // Render subdirectories
        for (const child of children) {
          output += renderDir(child, depth + 1);
        }

        // Render files in this directory
        const dirFiles = filesByDir.get(dirPath) || [];
        for (const file of dirFiles.sort()) {
          const fileName = path.basename(file);
          if (!file.endsWith("/")) {
            output += `${childIndent}${fileName}\n`;
          }
        }

        return output;
      }

      return renderDir("", 0);
    }

    const output = `${searchPath}/\n` + buildTree(files);

    return {
      content: output,
      data: {
        path: searchPath,
        count: files.length,
        truncated,
        entries: files,
      },
      activity: createActivity("directory_list", `Listed ${files.length} entries`, searchPath, files.length),
    };
  },
};
