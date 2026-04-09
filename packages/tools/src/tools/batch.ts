/**
 * Batch tool - executes multiple tools in parallel.
 * Based on OpenCode's batch.ts implementation.
 */

import type { RegisteredTool, ToolRegistry, ToolCall, ToolResult, ToolCapability } from "../types.js";
import { createActivity, returnsSchema } from "../types.js";

const DISALLOWED = new Set(["batch"]);

interface BatchToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

// We need access to the registry to execute batch calls
let registryInstance: ToolRegistry | null = null;

export function setBatchRegistry(registry: ToolRegistry) {
  registryInstance = registry;
}

export const batchTool: RegisteredTool = {
  definition: {
    name: "batch",
    description: `Executes multiple tool calls in parallel.

Usage:
- Run up to 25 independent tool calls simultaneously for optimal performance
- Each tool call is executed in parallel
- Results are returned for all calls
- Disallowed tools: batch (cannot nest batch calls)
- If one tool call fails, others may still succeed

Important: All tool calls in a batch should be independent. Don't chain dependent operations in a single batch - use sequential calls for that.`,
    parameters: {
      type: "object",
      properties: {
        tool_calls: {
          type: "array",
          description: "Array of tool calls to execute in parallel",
          minItems: 1,
          maxItems: 25,
          items: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                description: "The name of the tool to execute",
              },
              parameters: {
                type: "object",
                description: "Parameters for the tool",
              },
            },
            required: ["tool", "parameters"],
          },
        },
      },
      required: ["tool_calls"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        total: { type: "number" },
        successful: { type: "number" },
        failed: { type: "number" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              success: { type: "boolean" },
              output: { type: "string" },
              error: { type: "string" },
            },
          },
        },
      },
      required: ["total", "successful", "failed"],
      additionalProperties: false,
    }),
    capability: "batch",
  },

  async execute(args) {
    const toolCalls = args.tool_calls as BatchToolCall[];

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      throw new Error("tool_calls must be a non-empty array");
    }

    if (toolCalls.length > 25) {
      throw new Error("Maximum of 25 tools allowed in batch");
    }

    if (!registryInstance) {
      throw new Error("Batch tool not properly initialized - registry not set");
    }

    const results: Array<{
      tool: string;
      success: boolean;
      output?: string;
      error?: string;
      data?: unknown;
    }> = [];

    // Execute all tools in parallel
    const promises = toolCalls.map(async (call) => {
      if (DISALLOWED.has(call.tool)) {
        return {
          tool: call.tool,
          success: false,
          error: `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
        };
      }

      const toolCall: ToolCall = {
        id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: call.tool,
        args: call.parameters,
      };

      try {
        // Get all available capabilities for batch execution
        const allCapabilities: ToolCapability[] = [
          "read",
          "write",
          "edit",
          "search",
          "shell",
          "web",
          "agent",
          "lsp",
          "skill",
          "batch",
        ];

        if (!registryInstance) {
          throw new Error("Registry not initialized");
        }

        const result = await registryInstance.execute(toolCall, allCapabilities);

        return {
          tool: call.tool,
          success: !result.isError,
          output: result.content,
          error: result.isError ? result.content : undefined,
          data: result.data,
        };
      } catch (error) {
        return {
          tool: call.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const executedResults = await Promise.all(promises);
    results.push(...executedResults);

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    const outputMessage =
      failed > 0
        ? `Executed ${successful}/${results.length} tools successfully. ${failed} failed.`
        : `All ${successful} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`;

    return {
      content: outputMessage,
      data: {
        total: results.length,
        successful,
        failed,
        results: results.map((r) => ({
          tool: r.tool,
          success: r.success,
          output: r.output,
          error: r.error,
        })),
      },
      activity: createActivity(
        "batch_exec",
        `Batch: ${successful}/${results.length} successful`,
        undefined,
        results.length,
      ),
    };
  },
};
