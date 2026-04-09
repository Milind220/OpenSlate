/**
 * Todo tool - manages session todo lists.
 * Based on OpenCode's todo.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, returnsSchema } from "../types.js";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
}

// Simple in-memory store for todos (in production, this would be persisted)
const todoStore = new Map<string, TodoItem[]>();

export const todoTool: RegisteredTool = {
  definition: {
    name: "todo",
    description: `Manages a structured todo list for the current session.

Usage:
- Creates and manages todo items with status tracking
- Each todo has: id, content, status (pending/in_progress/completed/cancelled), priority (low/medium/high)
- Use this to track progress on complex multi-step tasks
- Call with the complete updated list each time (replaces previous state)
- Useful for organizing work and showing progress to the user`,
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The updated todo list - this replaces the entire previous state",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Unique identifier for the todo item",
              },
              content: {
                type: "string",
                description: "Brief description of the task",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
                description: "Current status of the todo",
              },
              priority: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "Priority level of the task",
              },
            },
            required: ["id", "content", "status", "priority"],
          },
        },
      },
      required: ["todos"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: { type: "string" },
              priority: { type: "string" },
            },
          },
        },
        pending: { type: "number" },
        in_progress: { type: "number" },
        completed: { type: "number" },
        cancelled: { type: "number" },
      },
      required: ["todos", "pending", "in_progress", "completed", "cancelled"],
      additionalProperties: false,
    }),
    capability: "agent",
  },

  async execute(args) {
    const todos = args.todos as TodoItem[];

    if (!Array.isArray(todos)) {
      throw new Error("todos must be an array");
    }

    // Validate each todo
    for (const todo of todos) {
      if (!todo.id || typeof todo.id !== "string") {
        throw new Error("Each todo must have an id string");
      }
      if (!todo.content || typeof todo.content !== "string") {
        throw new Error("Each todo must have a content string");
      }
      if (!["pending", "in_progress", "completed", "cancelled"].includes(todo.status)) {
        throw new Error("Each todo must have a valid status: pending, in_progress, completed, or cancelled");
      }
      if (!["low", "medium", "high"].includes(todo.priority)) {
        throw new Error("Each todo must have a valid priority: low, medium, or high");
      }
    }

    // Count by status
    const counts = {
      pending: todos.filter((t) => t.status === "pending").length,
      in_progress: todos.filter((t) => t.status === "in_progress").length,
      completed: todos.filter((t) => t.status === "completed").length,
      cancelled: todos.filter((t) => t.status === "cancelled").length,
    };

    // Store the todos (in production, this would persist to a database)
    const sessionId = "current"; // In a real implementation, this would be the actual session ID
    todoStore.set(sessionId, todos);

    // Format output
    const lines = [
      `${counts.completed}/${todos.length} tasks completed`,
      "",
      ...todos.map((todo) => {
        const statusIcon =
          todo.status === "completed"
            ? "✓"
            : todo.status === "in_progress"
              ? "▶"
              : todo.status === "cancelled"
                ? "✗"
                : "○";
        const priorityIcon = todo.priority === "high" ? "🔴" : todo.priority === "medium" ? "🟡" : "🟢";
        return `${statusIcon} ${priorityIcon} ${todo.content}`;
      }),
    ];

    return {
      content: lines.join("\n"),
      data: {
        todos,
        ...counts,
      },
      activity: createActivity(
        "todo_update",
        `${counts.completed}/${todos.length} tasks completed`,
        undefined,
        todos.length,
      ),
    };
  },
};

// Helper to get todos for a session
export function getSessionTodos(sessionId: string): TodoItem[] {
  return todoStore.get(sessionId) ?? [];
}
