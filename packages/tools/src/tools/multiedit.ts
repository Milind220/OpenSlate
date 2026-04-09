/**
 * MultiEdit tool - applies multiple sequential edits to a single file.
 * Based on OpenCode's multiedit.ts implementation.
 */

import * as path from "node:path";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema, optionalBooleanArg } from "../types.js";
import { replace, detectLineEnding, normalizeLineEndings, convertToLineEnding } from "./edit.js";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

export const multiEditTool: RegisteredTool = {
  definition: {
    name: "multiedit",
    description: `Applies multiple sequential edits to a single file.

Usage:
- This tool applies multiple edit operations to a single file in sequence.
- Each edit is applied one after another, so later edits can depend on earlier ones.
- All edits use the same fuzzy matching algorithm as the edit tool.
- If any edit fails, the file will be left in the state after the last successful edit.`,
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The absolute path to the file to modify",
        },
        edits: {
          type: "array",
          description: "Array of edit operations to perform sequentially on the file",
          items: {
            type: "object",
            properties: {
              oldString: {
                type: "string",
                description: "The text to replace",
              },
              newString: {
                type: "string",
                description: "The text to replace it with",
              },
              replaceAll: {
                type: "boolean",
                description: "Replace all occurrences of oldString (default false)",
              },
            },
            required: ["oldString", "newString"],
          },
        },
      },
      required: ["filePath", "edits"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        editCount: { type: "number" },
        successfulEdits: { type: "number" },
      },
      required: ["path", "editCount", "successfulEdits"],
      additionalProperties: false,
    }),
    capability: "edit",
  },

  async execute(args) {
    const filePath = requiredStringArg(args, "filePath");
    const edits = args.edits as Array<{ oldString: string; newString: string; replaceAll?: boolean }>;

    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error("edits must be a non-empty array");
    }

    // Ensure absolute path
    let filepath = filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(process.cwd(), filepath);
    }

    // Check file exists
    if (!existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }

    const stats = statSync(filepath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filepath}`);
    }

    // Read initial content
    let content = readFileSync(filepath, "utf-8");
    const ending = detectLineEnding(content);

    const results = [];
    let successfulEdits = 0;

    // Apply each edit in sequence
    for (const edit of edits) {
      const oldString = edit.oldString;
      const newString = edit.newString;
      const replaceAllFlag = edit.replaceAll ?? false;

      if (oldString === newString) {
        results.push({ status: "skipped", reason: "oldString and newString are identical" });
        continue;
      }

      const old = convertToLineEnding(normalizeLineEndings(oldString), ending);
      const next = convertToLineEnding(normalizeLineEndings(newString), ending);

      try {
        content = replace(content, old, next, replaceAllFlag);
        successfulEdits++;
        results.push({ status: "success" });
      } catch (error) {
        results.push({ status: "error", error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }

    // Write back the final content
    writeFileSync(filepath, content, "utf-8");

    const hasErrors = results.some((r) => r.status === "error");

    return {
      content: hasErrors
        ? `Applied ${successfulEdits}/${edits.length} edits to ${filepath}. Some edits failed.`
        : `Successfully applied all ${edits.length} edits to ${filepath}`,
      data: {
        path: filepath,
        editCount: edits.length,
        successfulEdits,
        results,
      },
      activity: createActivity("file_multiedit", `Applied ${successfulEdits} edits`, filepath, successfulEdits),
    };
  },
};
