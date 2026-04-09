/**
 * Write tool - writes content to files.
 * Based on OpenCode's write.ts implementation.
 */

import * as path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema } from "../types.js";

export const writeTool: RegisteredTool = {
  definition: {
    name: "write",
    description: `Writes a file to the local filesystem. Overwrites existing files if present.

Usage:
- This tool will overwrite existing files if they exist.
- The filePath parameter must be an absolute path, not a relative path.
- Always prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.`,
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The content to write to the file",
        },
        filePath: {
          type: "string",
          description: "The absolute path to the file to write (must be absolute, not relative)",
        },
      },
      required: ["content", "filePath"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        lineCount: { type: "number" },
        exists: { type: "boolean" },
      },
      required: ["path", "lineCount", "exists"],
      additionalProperties: false,
    }),
    capability: "write",
  },

  async execute(args) {
    const content = requiredStringArg(args, "content");
    const filePath = requiredStringArg(args, "filePath");

    // Ensure absolute path
    let filepath = filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(process.cwd(), filepath);
    }

    const existed = existsSync(filepath);

    // Create parent directories
    const dir = path.dirname(filepath);
    mkdirSync(dir, { recursive: true });

    // Write file
    writeFileSync(filepath, content, "utf-8");

    const lineCount = content.split("\n").length;

    return {
      content: `Wrote ${lineCount} lines to ${filepath}${existed ? " (overwrote existing file)" : ""}`,
      data: {
        path: filepath,
        lineCount,
        exists: existed,
      },
      activity: createActivity("file_write", `Wrote ${lineCount} lines`, filepath, lineCount),
    };
  },
};
