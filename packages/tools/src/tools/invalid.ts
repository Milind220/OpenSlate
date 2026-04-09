/**
 * Invalid tool - fallback handler for unknown/invalid tool calls.
 * Based on OpenCode's invalid.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema } from "../types.js";

export const invalidTool: RegisteredTool = {
  definition: {
    name: "invalid",
    description: "Fallback handler for unknown or invalid tool calls. Returns error message with guidance.",
    parameters: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "The name of the tool that was called",
        },
        error: {
          type: "string",
          description: "Description of why the tool call was invalid",
        },
      },
      required: ["tool", "error"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        tool: { type: "string" },
        error: { type: "string" },
      },
      required: ["tool", "error"],
      additionalProperties: false,
    }),
    capability: "agent",
  },

  async execute(args) {
    const tool = requiredStringArg(args, "tool");
    const error = requiredStringArg(args, "error");

    return {
      content: `Invalid tool call: "${tool}"\n\nError: ${error}\n\nPlease check that:\n1. The tool name is spelled correctly\n2. All required parameters are provided\n3. Parameter types match the expected schema`,
      data: {
        tool,
        error,
      },
      activity: createActivity("invalid_tool", `Invalid tool: ${tool}`, tool),
    };
  },
};
