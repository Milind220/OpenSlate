import { describe, expect, test } from "bun:test";
import { buildAIMessages, normalizeRouterToolCalls } from "./bootstrap.js";

describe("normalizeRouterToolCalls", () => {
  test("maps AI SDK input field into child runtime args", () => {
    const toolCalls = normalizeRouterToolCalls([
      {
        toolCallId: "functions.shell:0",
        toolName: "shell",
        input: { command: "ls" },
      },
    ]);

    expect(toolCalls).toEqual([
      {
        toolCallId: "functions.shell:0",
        toolName: "shell",
        args: { command: "ls" },
      },
    ]);
  });
});

describe("buildAIMessages", () => {
  test("serializes assistant tool calls and tool results in AI SDK prompt shape", () => {
    const messages = buildAIMessages([
      { role: "user", content: "Inspect the repo." },
      {
        role: "assistant",
        content: "I will inspect the repo.",
        toolCalls: [
          {
            id: "functions.shell:0",
            name: "shell",
            args: { command: "ls" },
          },
        ],
      },
      {
        role: "tool",
        content: "packages\ndocs",
        toolCallId: "functions.shell:0",
        toolName: "shell",
      },
      {
        role: "tool",
        content: "permission denied",
        toolCallId: "functions.shell:0",
        toolName: "shell",
        isError: true,
      },
    ]);

    expect(messages).toEqual([
      { role: "user", content: "Inspect the repo." },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the repo." },
          {
            type: "tool-call",
            toolCallId: "functions.shell:0",
            toolName: "shell",
            input: { command: "ls" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "functions.shell:0",
            toolName: "shell",
            input: { command: "ls" },
            output: { type: "text", value: "packages\ndocs" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "functions.shell:0",
            toolName: "shell",
            input: { command: "ls" },
            output: { type: "error-text", value: "permission denied" },
          },
        ],
      },
    ]);
  });
});
