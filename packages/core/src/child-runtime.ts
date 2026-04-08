/**
 * Child runtime loop — bounded execution for thread sessions.
 *
 * This is the first real tool-calling agent loop in OpenSlate.
 * A child thread gets a task, can call tools in a bounded loop,
 * and produces a structured WorkerReturn.
 *
 * Design rules:
 * - bounded to a configurable max iterations (default 20)
 * - child cannot spawn sub-children (no recursion yet)
 * - child uses the "execute" model slot
 * - every run produces exactly one WorkerReturn
 */

import type { SessionId, MessagePart } from "./types/index.js";
import type { MessageStore } from "./storage/message-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ChildToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChildToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export interface ChildModelCallInput {
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    toolCalls?: ChildToolCall[];
  }>;
  system?: string;
  tools?: Record<string, { description: string; parameters: Record<string, unknown> }>;
}

export interface ChildModelCallResult {
  text: string;
  toolCalls: ChildToolCall[];
  finishReason: "stop" | "tool-calls" | "length" | "error" | "unknown";
}

export type ChildModelCallFn = (input: ChildModelCallInput) => Promise<ChildModelCallResult>;

export type ToolExecutorFn = (call: ChildToolCall) => Promise<ChildToolResult>;

export interface ChildRuntimeConfig {
  childSessionId: SessionId;
  task: string;
  systemPrompt?: string;
  tools?: Record<string, { description: string; parameters: Record<string, unknown> }>;
  maxIterations?: number;
}

export interface ChildRuntimeDeps {
  messageStore: MessageStore;
  events: EventBus;
  modelCall: ChildModelCallFn;
  executeTool: ToolExecutorFn;
}

export interface ChildRunResult {
  status: "completed" | "aborted" | "failed";
  output: string;
  iterations: number;
}

// ── Child Runtime Loop ───────────────────────────────────────────────

export async function runChildLoop(
  config: ChildRuntimeConfig,
  deps: ChildRuntimeDeps,
): Promise<ChildRunResult> {
  const { childSessionId, task, systemPrompt, tools, maxIterations = 20 } = config;
  const { messageStore, events, modelCall, executeTool } = deps;

  // 1. Append the task as a user message
  const taskMessage = messageStore.append({
    sessionId: childSessionId,
    role: "user",
    parts: [{ kind: "text", content: task }],
  });
  events.emit(RuntimeEvents.messageCreated(childSessionId, taskMessage.id, "user"));

  let iterations = 0;
  let lastOutput = "";

  while (iterations < maxIterations) {
    iterations++;

    // 2. Build full transcript from persisted messages
    const history = messageStore.listBySession(childSessionId);
    const modelMessages = buildModelMessages(history);

    // 3. Call model with tools
    events.emit(RuntimeEvents.assistantStarted(childSessionId));

    let result: ChildModelCallResult;
    try {
      result = await modelCall({
        messages: modelMessages,
        system: systemPrompt ?? buildChildSystemPrompt(task),
        tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const errMsg = messageStore.append({
        sessionId: childSessionId,
        role: "assistant",
        parts: [{ kind: "status", content: "error: " + error }],
      });
      events.emit(RuntimeEvents.messageCreated(childSessionId, errMsg.id, "assistant"));
      events.emit(RuntimeEvents.assistantFailed(childSessionId, errMsg.id, error));
      return { status: "failed", output: "Child model call failed: " + error, iterations };
    }

    // 4. If model wants to call tools
    if (result.finishReason === "tool-calls" && result.toolCalls.length > 0) {
      const toolCallParts: MessagePart[] = [];
      if (result.text) {
        toolCallParts.push({ kind: "text", content: result.text });
      }
      for (const tc of result.toolCalls) {
        toolCallParts.push({
          kind: "tool_call",
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
        });
      }
      const assistantMsg = messageStore.append({
        sessionId: childSessionId,
        role: "assistant",
        parts: toolCallParts,
      });
      events.emit(RuntimeEvents.messageCreated(childSessionId, assistantMsg.id, "assistant"));

      // 5. Execute each tool call
      const toolResults: ChildToolResult[] = [];
      for (const tc of result.toolCalls) {
        const toolResult = await executeTool(tc);
        toolResults.push(toolResult);
      }

      // 6. Persist tool results
      const toolResultParts: MessagePart[] = toolResults.map((tr) => ({
        kind: "tool_result" as const,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        content: tr.content,
        isError: tr.isError,
      }));
      const toolMsg = messageStore.append({
        sessionId: childSessionId,
        role: "tool",
        parts: toolResultParts,
      });
      events.emit(RuntimeEvents.messageCreated(childSessionId, toolMsg.id, "tool"));

      continue;
    }

    // 7. Model finished — this is the child's final response
    const finalParts: MessagePart[] = [];
    if (result.text) {
      finalParts.push({ kind: "text", content: result.text });
    }
    if (finalParts.length === 0) {
      finalParts.push({ kind: "text", content: "(no output)" });
    }

    const finalMsg = messageStore.append({
      sessionId: childSessionId,
      role: "assistant",
      parts: finalParts,
    });
    events.emit(RuntimeEvents.messageCreated(childSessionId, finalMsg.id, "assistant"));
    events.emit(RuntimeEvents.assistantCompleted(childSessionId, finalMsg.id));

    lastOutput = result.text || "(no output)";
    return { status: "completed", output: lastOutput, iterations };
  }

  return {
    status: "aborted",
    output: "Child reached max iterations (" + maxIterations + ") without completing. Last output: " + lastOutput,
    iterations,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ModelMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  toolCalls?: ChildToolCall[];
}

function buildModelMessages(messages: Array<{ role: string; parts: MessagePart[] }>): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      for (const part of msg.parts) {
        if (part.kind === "tool_result") {
          result.push({
            role: "tool",
            content: part.content,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            isError: part.isError,
          });
        }
      }
    } else if (msg.role === "assistant") {
      const toolCalls = msg.parts
        .filter((p): p is Extract<MessagePart, { kind: "tool_call" }> => p.kind === "tool_call")
        .map((p) => ({ id: p.toolCallId, name: p.toolName, args: p.args }));

      const textContent = msg.parts
        .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
        .map((p) => p.content)
        .join("\n");

      if (toolCalls.length > 0) {
        result.push({ role: "assistant", content: textContent, toolCalls });
      } else {
        result.push({
          role: "assistant",
          content: textContent || msg.parts.map((p) => "content" in p ? (p as any).content : "").join("\n"),
        });
      }
    } else {
      const content = msg.parts
        .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
        .map((p) => p.content)
        .join("\n");
      result.push({ role: "user", content });
    }
  }

  return result;
}

function buildChildSystemPrompt(task: string): string {
  return "You are a focused worker thread in the OpenSlate system. Your task is:\n\n" + task + "\n\nInstructions:\n- Use the available tools to complete your task\n- Be thorough but focused — do not go beyond the scope of the task\n- When you have completed the task, provide a clear summary of what you found or did\n- If you cannot complete the task, explain why clearly\n- Do not ask follow-up questions — complete the task to the best of your ability";
}
