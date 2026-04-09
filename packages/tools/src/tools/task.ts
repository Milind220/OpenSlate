/**
 * Task tool - spawns subagent tasks.
 * Based on OpenCode's task.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalStringArg, returnsSchema } from "../types.js";

export const taskTool: RegisteredTool = {
  definition: {
    name: "task",
    description: `Spawns a subagent task for parallel execution.

Usage:
- Creates a child session with specific agent types (explore, general, etc.)
- Supports task resumption via task_id
- Use when you need to delegate work to specialized subagents
- Subagents can run in parallel to main task execution`,
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A short (3-5 words) description of the task",
        },
        prompt: {
          type: "string",
          description: "The task for the agent to perform",
        },
        subagent_type: {
          type: "string",
          description: "The type of specialized agent to use for this task",
        },
        task_id: {
          type: "string",
          description: "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
        },
      },
      required: ["description", "prompt", "subagent_type"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        task_id: { type: "string" },
        description: { type: "string" },
        subagent_type: { type: "string" },
        status: { type: "string" },
        result: { type: "string" },
      },
      required: ["task_id", "description", "subagent_type", "status"],
      additionalProperties: false,
    }),
    capability: "agent",
  },

  async execute(args) {
    const description = requiredStringArg(args, "description");
    const prompt = requiredStringArg(args, "prompt");
    const subagentType = requiredStringArg(args, "subagent_type");
    const taskId = optionalStringArg(args, "task_id");

    // Generate a task ID if not resuming
    const newTaskId = taskId ?? `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // In a full implementation, this would:
    // 1. Spawn a new subagent session
    // 2. Execute the task with the specified subagent type
    // 3. Return the result
    // For now, we return a placeholder indicating the task was created

    const result = {
      task_id: newTaskId,
      description,
      subagent_type: subagentType,
      status: "created",
      result: `Task created with ID: ${newTaskId}\n\nThis is a placeholder implementation. In a full implementation, the task would be:\n- Description: ${description}\n- Prompt: ${prompt}\n- Subagent Type: ${subagentType}\n\nNote: Subagent execution requires additional infrastructure not available in this implementation.`,
    };

    return {
      content: [
        `task_id: ${newTaskId} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        result.result,
        "</task_result>",
      ].join("\n"),
      data: result,
      activity: createActivity("task_spawn", `Spawned task: ${description}`, newTaskId),
    };
  },
};
