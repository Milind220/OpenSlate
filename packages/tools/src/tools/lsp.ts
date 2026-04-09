/**
 * LSP tool - Language Server Protocol operations.
 * Based on OpenCode's lsp.ts implementation.
 */

import * as path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalNumberArg, returnsSchema } from "../types.js";

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const;

export const lspTool: RegisteredTool = {
  definition: {
    name: "lsp",
    description: `Language Server Protocol (LSP) operations for code intelligence.

Usage:
- goToDefinition: Jump to the definition of a symbol
- findReferences: Find all references to a symbol
- hover: Get hover information (type/documentation) for a symbol
- documentSymbol: List all symbols in a document
- workspaceSymbol: Search for symbols across the workspace
- goToImplementation: Jump to implementation of an interface/abstract method
- prepareCallHierarchy: Prepare call hierarchy for a symbol
- incomingCalls: Find incoming calls to a function/method
- outgoingCalls: Find outgoing calls from a function/method

Note: This tool requires an LSP server to be running for the file type.
Coordinates are 1-based (as shown in editors).`,
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: operations,
          description: "The LSP operation to perform",
        },
        filePath: {
          type: "string",
          description: "The absolute or relative path to the file",
        },
        line: {
          type: "number",
          description: "The line number (1-based, as shown in editors)",
        },
        character: {
          type: "number",
          description: "The character offset (1-based, as shown in editors)",
        },
      },
      required: ["operation", "filePath", "line", "character"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        operation: { type: "string" },
        filePath: { type: "string" },
        line: { type: "number" },
        character: { type: "number" },
        results: { type: "array" },
      },
      required: ["operation", "filePath", "line", "character"],
      additionalProperties: false,
    }),
    capability: "lsp",
  },

  async execute(args) {
    const operation = requiredStringArg(args, "operation") as (typeof operations)[number];
    const filePath = requiredStringArg(args, "filePath");
    const line = optionalNumberArg(args, "line") ?? 1;
    const character = optionalNumberArg(args, "character") ?? 1;

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
      throw new Error(`Path is a directory: ${filepath}`);
    }

    // In a full implementation, this would:
    // 1. Connect to the appropriate LSP server for the file type
    // 2. Send the LSP request
    // 3. Return the results

    // For now, return a placeholder
    const placeholderResult = {
      operation,
      filePath: filepath,
      line,
      character,
      results: [],
      note: "LSP integration requires additional infrastructure. This is a placeholder implementation.",
    };

    return {
      content: `LSP operation "${operation}" at ${filepath}:${line}:${character}\n\nNote: This is a placeholder implementation. In a full environment with LSP servers configured, this would return actual code intelligence results.`,
      data: placeholderResult,
      activity: createActivity("lsp_operation", `LSP: ${operation}`, filepath),
    };
  },
};
