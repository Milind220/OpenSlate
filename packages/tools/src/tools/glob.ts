/**
 * Glob tool - finds files matching glob patterns.
 * Based on OpenCode's glob.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalStringArg, returnsSchema } from "../types.js";

export const globTool: RegisteredTool = {
  definition: {
    name: "glob",
    description: `Fast file pattern matching tool that works with any codebase size.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The glob pattern to match files against (e.g., '**/*.ts', 'src/**/*.js')",
        },
        path: {
          type: "string",
          description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
        },
      },
      required: ["pattern"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        count: { type: "number" },
        paths: { type: "array", items: { type: "string" } },
        truncated: { type: "boolean" },
      },
      required: ["pattern", "path", "count", "paths", "truncated"],
      additionalProperties: false,
    }),
    capability: "search",
  },

  async execute(args) {
    const pattern = requiredStringArg(args, "pattern");
    const searchPath = optionalStringArg(args, "path") ?? process.cwd();

    const limit = 100;
    const results: string[] = [];
    let truncated = false;

    try {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({
        cwd: searchPath,
        onlyFiles: true,
        absolute: true,
      })) {
        if (results.length >= limit) {
          truncated = true;
          break;
        }
        results.push(file);
      }

      // Sort by modification time (most recent first)
      results.sort((a, b) => {
        try {
          const statA = Bun.file(a).lastModified;
          const statB = Bun.file(b).lastModified;
          return statB - statA;
        } catch {
          return 0;
        }
      });
    } catch (error) {
      throw new Error(`Glob search failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const output = [];
    if (results.length === 0) {
      output.push("No files found");
    } else {
      output.push(...results);
      if (truncated) {
        output.push("");
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        );
      }
    }

    return {
      content: output.join("\n"),
      data: {
        pattern,
        path: searchPath,
        count: results.length,
        paths: results,
        truncated,
      },
      activity: createActivity("glob_files", `Matched ${results.length} files`, searchPath, results.length),
    };
  },
};
