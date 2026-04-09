/**
 * Child runtime loop — bounded execution for thread sessions.
 */

import type {
  SessionId,
  MessagePart,
  ChildPromptEpisode,
} from "./types/index.js";
import type { MessageStore } from "./storage/message-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";
import type {
  CompletionContractSignal,
  CompletionContractValidity,
  ToolCallSummary,
} from "./types/worker-return.js";
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
  tools?: Record<
    string,
    { description: string; parameters: Record<string, unknown> }
  >;
}

export interface ChildModelCallResult {
  text: string;
  toolCalls: ChildToolCall[];
  finishReason: "stop" | "tool-calls" | "length" | "error" | "unknown";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  estimatedCostUsd?: number | null;
}

export type ChildModelCallFn = (
  input: ChildModelCallInput,
) => Promise<ChildModelCallResult>;
export type ToolExecutorFn = (call: ChildToolCall) => Promise<ChildToolResult>;

export interface ChildRuntimeConfig {
  childSessionId: SessionId;
  task: string;
  systemPrompt?: string;
  tools?: Record<
    string,
    { description: string; parameters: Record<string, unknown> }
  >;
  inputEpisodes?: ChildPromptEpisode[];
  maxIterations?: number;
}
export interface ChildRuntimeDeps {
  messageStore: MessageStore;
  events: EventBus;
  modelCall: ChildModelCallFn;
  executeTool: ToolExecutorFn;
}

export interface ChildStructuredReturn {
  summary: string | null;
  keyFindings: string[];
  filesRead: string[];
  filesChanged: string[];
  openQuestions: string[];
  nextActions: string[];
}

export interface ChildRunResult {
  status: "completed" | "aborted" | "failed";
  output: string;
  iterations: number;
  structuredReturn?: ChildStructuredReturn | null;
  completionContract: CompletionContractSignal;
  toolCalls: ToolCallSummary[];
  filesRead: string[];
  filesChanged: string[];
  durationMs?: number;
  model?: string | null;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd?: number | null;
}

interface ParsedStructuredReturn {
  structured: ChildStructuredReturn | null;
  completionContract: CompletionContractSignal;
}

export async function runChildLoop(
  config: ChildRuntimeConfig,
  deps: ChildRuntimeDeps,
): Promise<ChildRunResult> {
  const {
    childSessionId,
    task,
    systemPrompt,
    tools,
    inputEpisodes,
    maxIterations = 20,
  } = config;
  const { messageStore, events, modelCall, executeTool } = deps;
  const startedAtMs = Date.now();
  const runtimeToolCalls: ToolCallSummary[] = [];
  const runtimeFilesRead = new Set<string>();
  const runtimeFilesChanged = new Set<string>();
  let accumulatedUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let lastModel: string | null = null;
  let estimatedCostUsd: number | null = null;

  const taskMessage = messageStore.append({
    sessionId: childSessionId,
    role: "user",
    parts: [{ kind: "text", content: task }],
  });
  events.emit(
    RuntimeEvents.messageCreated(childSessionId, taskMessage.id, "user"),
  );

  let iterations = 0;
  let lastOutput = "";

  while (iterations < maxIterations) {
    iterations++;

    const history = messageStore.listBySession(childSessionId);
    const modelMessages = buildModelMessages(history);

    events.emit(RuntimeEvents.assistantStarted(childSessionId));

    let result: ChildModelCallResult;
    try {
      result = await modelCall({
        messages: modelMessages,
        system:
          systemPrompt ?? buildChildSystemPrompt(task, tools, inputEpisodes),
        tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
      });
    } catch (err) {      const error = err instanceof Error ? err.message : String(err);
      const errMsg = messageStore.append({
        sessionId: childSessionId,
        role: "assistant",
        parts: [{ kind: "status", content: "error: " + error }],
      });
      events.emit(
        RuntimeEvents.messageCreated(childSessionId, errMsg.id, "assistant"),
      );
      events.emit(
        RuntimeEvents.assistantFailed(childSessionId, errMsg.id, error),
      );
      return {
        status: "failed",
        output: "Child model call failed: " + error,
        iterations,
        structuredReturn: null,
        completionContract: {
          validity: "missing",
          issues: [
            "Model call failed before a completion contract was emitted.",
          ],
        },
        toolCalls: runtimeToolCalls,
        filesRead: [...runtimeFilesRead],
        filesChanged: [...runtimeFilesChanged],
        durationMs: Date.now() - startedAtMs,
        model: lastModel,
        tokenUsage: accumulatedUsage.totalTokens > 0 ? accumulatedUsage : null,
        estimatedCostUsd,
      };
    }

    if (result.usage) {
      accumulatedUsage = {
        promptTokens: accumulatedUsage.promptTokens + result.usage.promptTokens,
        completionTokens:
          accumulatedUsage.completionTokens + result.usage.completionTokens,
        totalTokens: accumulatedUsage.totalTokens + result.usage.totalTokens,
      };
    }

    if (result.model) lastModel = result.model;
    if (
      typeof result.estimatedCostUsd === "number" &&
      Number.isFinite(result.estimatedCostUsd)
    ) {
      estimatedCostUsd = (estimatedCostUsd ?? 0) + result.estimatedCostUsd;
    }

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
      events.emit(
        RuntimeEvents.messageCreated(
          childSessionId,
          assistantMsg.id,
          "assistant",
        ),
      );

      const toolResults: ChildToolResult[] = [];
      for (const tc of result.toolCalls) {
        events.emit(
          RuntimeEvents.threadToolStarted(childSessionId, tc.name, tc.id),
        );
        events.emit(
          RuntimeEvents.threadActivity(
            childSessionId,
            `Running tool ${tc.name}`,
          ),
        );

        const toolResult = await executeTool(tc);
        toolResults.push(toolResult);

        const fileEffects = inferFileEffectsFromToolCall(tc);
        for (const path of fileEffects.filesRead) runtimeFilesRead.add(path);
        for (const path of fileEffects.filesChanged)
          runtimeFilesChanged.add(path);

        runtimeToolCalls.push({
          toolCallId: tc.id,
          tool: tc.name,
          args: tc.args,
          result: toolResult.content,
          isError: toolResult.isError,
        });

        events.emit(
          RuntimeEvents.threadToolCompleted(
            childSessionId,
            tc.name,
            tc.id,
            toolResult.isError,
          ),
        );
        events.emit(
          RuntimeEvents.threadActivity(
            childSessionId,
            toolResult.isError
              ? `Tool ${tc.name} failed`
              : `Tool ${tc.name} completed`,
          ),
        );
      }

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
      events.emit(
        RuntimeEvents.messageCreated(childSessionId, toolMsg.id, "tool"),
      );

      continue;
    }

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
    events.emit(
      RuntimeEvents.messageCreated(childSessionId, finalMsg.id, "assistant"),
    );
    events.emit(RuntimeEvents.assistantCompleted(childSessionId, finalMsg.id));

    lastOutput = result.text || "(no output)";
    const parsed = parseStructuredReturn(lastOutput);
    const mergedFilesRead = new Set<string>([
      ...runtimeFilesRead,
      ...(parsed.structured?.filesRead ?? []),
    ]);
    const mergedFilesChanged = new Set<string>([
      ...runtimeFilesChanged,
      ...(parsed.structured?.filesChanged ?? []),
    ]);

    return {
      status: "completed",
      output: lastOutput,
      iterations,
      structuredReturn: parsed.structured,
      completionContract: parsed.completionContract,
      toolCalls: runtimeToolCalls,
      filesRead: [...mergedFilesRead],
      filesChanged: [...mergedFilesChanged],
      durationMs: Date.now() - startedAtMs,
      model: lastModel,
      tokenUsage: accumulatedUsage.totalTokens > 0 ? accumulatedUsage : null,
      estimatedCostUsd:
        estimatedCostUsd == null ? null : Number(estimatedCostUsd.toFixed(6)),
    };
  }

  const parsed = parseStructuredReturn(lastOutput);
  const mergedFilesRead = new Set<string>([
    ...runtimeFilesRead,
    ...(parsed.structured?.filesRead ?? []),
  ]);
  const mergedFilesChanged = new Set<string>([
    ...runtimeFilesChanged,
    ...(parsed.structured?.filesChanged ?? []),
  ]);

  return {
    status: "aborted",
    output:
      "Child reached max iterations (" +
      maxIterations +
      ") without completing. Last output: " +
      lastOutput,
    iterations,
    structuredReturn: parsed.structured,
    completionContract:
      parsed.completionContract.validity === "valid"
        ? {
            validity: "malformed",
            issues: [
              "Child exited due to max iterations before a valid completion contract could be trusted.",
            ],
          }
        : parsed.completionContract,
    toolCalls: runtimeToolCalls,
    filesRead: [...mergedFilesRead],
    filesChanged: [...mergedFilesChanged],
    durationMs: Date.now() - startedAtMs,
    model: lastModel,
    tokenUsage: accumulatedUsage.totalTokens > 0 ? accumulatedUsage : null,
    estimatedCostUsd:
      estimatedCostUsd == null ? null : Number(estimatedCostUsd.toFixed(6)),
  };
}

interface ModelMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  toolCalls?: ChildToolCall[];
}

function buildModelMessages(
  messages: Array<{ role: string; parts: MessagePart[] }>,
): ModelMessage[] {
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
        .filter(
          (p): p is Extract<MessagePart, { kind: "tool_call" }> =>
            p.kind === "tool_call",
        )
        .map((p) => ({ id: p.toolCallId, name: p.toolName, args: p.args }));

      const textContent = msg.parts
        .filter(
          (p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text",
        )
        .map((p) => p.content)
        .join("\n");

      if (toolCalls.length > 0) {
        result.push({ role: "assistant", content: textContent, toolCalls });
      } else {
        result.push({
          role: "assistant",
          content:
            textContent ||
            msg.parts
              .map((p) =>
                "content" in p
                  ? ((p as { content?: string }).content ?? "")
                  : "",
              )
              .join("\n"),
        });
      }
    } else {
      const content = msg.parts
        .filter(
          (p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text",
        )
        .map((p) => p.content)
        .join("\n");
      result.push({ role: "user", content });
    }
  }

  return result;
}

function buildChildSystemPrompt(
  task: string,
  tools?: Record<
    string,
    { description: string; parameters: Record<string, unknown> }
  >,
  inputEpisodes?: ChildPromptEpisode[],
): string {
  const toolNames = tools ? Object.keys(tools) : [];
  const toolList =
    tools && toolNames.length > 0
      ? toolNames
          .map(
            (name) =>
              `- ${name}: ${tools[name]?.description ?? "no description"}`,
          )
          .join("\n")
      : "- No tools available";
  const episodeContext = formatEpisodeContext(inputEpisodes ?? []);

  return [
    "You are a bounded child worker in the OpenSlate runtime.",
    "",
    "Task:",
    task,
    "",
    "Selected prior episodes (use as context, not as transcript):",
    episodeContext,
    "",
    "Available tools:",
    toolList,
    "",
    "Execution rules:",
    "- Stay tightly scoped to the stated task. Do not branch into unrelated work.",
    "- Use tools only when needed for evidence or execution.",
    "- Reuse prior episode findings where relevant and avoid repeating identical exploration.",
    "- Track what you read, what you changed, and key findings as you go.",
    "- If blocked, complete as much as possible and clearly note open questions.",
    "",
    "Before finishing, provide your normal response and then end with EXACTLY one fenced block:",
    "```worker_return",
    "{",
    '  "summary": "...",',
    '  "keyFindings": [...],',
    '  "filesRead": [...],',
    '  "filesChanged": [...],',
    '  "openQuestions": [...],',
    '  "nextActions": [...]',
    "}",
    "```",
    "",
    "The JSON must be valid. Use empty arrays when there are no items. Use null for summary only if unknown.",
  ].join("\n");
}

function formatEpisodeContext(episodes: ChildPromptEpisode[]): string {
  if (episodes.length === 0) {
    return "- none";
  }

  return episodes
    .map((episode, index) => {
      const findings =
        episode.keyFindings.length > 0
          ? episode.keyFindings.slice(0, 4).join(" | ")
          : "(none)";
      const files =
        episode.filesChanged.length > 0
          ? episode.filesChanged.slice(0, 4).join(" | ")
          : episode.filesRead.length > 0
            ? episode.filesRead.slice(0, 4).join(" | ")
            : "(none)";
      return [
        `- [${index + 1}] id=${episode.id}`,
        `  alias=${episode.alias ?? "(none)"} status=${episode.status}`,
        `  task=${episode.task}`,
        `  summary=${episode.summary ?? "(none)"}`,
        `  keyFindings=${findings}`,
        `  files=${files}`,
      ].join("\n");
    })
    .join("\n");
}

function parseStructuredReturn(text: string): ParsedStructuredReturn {
  if (!text || text.trim().length === 0) {
    return {      structured: null,
      completionContract: {
        validity: "missing",
        issues: ["Child response was empty; no worker_return block found."],
      },
    };
  }

  const match = text.match(/```worker_return\s*([\s\S]*?)```/i);
  if (!match || !match[1]) {
    return {
      structured: null,
      completionContract: {
        validity: "missing",
        issues: ["Missing required fenced worker_return JSON block."],
      },
    };
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const issues: string[] = [];

    const summaryRaw = parsed.summary;
    const summary =
      typeof summaryRaw === "string"
        ? summaryRaw
        : summaryRaw == null
          ? null
          : null;
    if (!(typeof summaryRaw === "string" || summaryRaw == null)) {
      issues.push("summary must be a string or null");
    }

    const normalizeStringArray = (field: string): string[] => {
      const raw = parsed[field];
      if (!Array.isArray(raw)) {
        issues.push(`${field} must be an array`);
        return [];
      }
      const strings = raw.filter((x): x is string => typeof x === "string");
      if (strings.length !== raw.length) {
        issues.push(`${field} must contain only strings`);
      }
      return strings;
    };

    const structured: ChildStructuredReturn = {
      summary,
      keyFindings: normalizeStringArray("keyFindings"),
      filesRead: normalizeStringArray("filesRead"),
      filesChanged: normalizeStringArray("filesChanged"),
      openQuestions: normalizeStringArray("openQuestions"),
      nextActions: normalizeStringArray("nextActions"),
    };

    const validity: CompletionContractValidity =
      issues.length === 0 ? "valid" : "malformed";

    return {
      structured,
      completionContract: {
        validity,
        issues,
      },
    };
  } catch {
    return {
      structured: null,
      completionContract: {
        validity: "malformed",
        issues: ["worker_return block is not valid JSON."],
      },
    };
  }
}

function inferFileEffectsFromToolCall(call: ChildToolCall): {
  filesRead: string[];
  filesChanged: string[];
} {
  const toolName = call.name.toLowerCase();
  const args = call.args;
  const path = typeof args.path === "string" ? args.path : null;
  const command =
    typeof args.command === "string" ? args.command.toLowerCase() : null;

  const filesRead: string[] = [];
  const filesChanged: string[] = [];

  if (path) {
    if (
      toolName.includes("read") ||
      toolName.includes("search") ||
      command === "read" ||
      command === "list"
    ) {
      filesRead.push(path);
    }

    if (
      toolName.includes("write") ||
      toolName.includes("edit") ||
      toolName.includes("delete") ||
      toolName.includes("patch") ||
      command === "write" ||
      command === "delete"
    ) {
      filesChanged.push(path);
    }
  }

  return { filesRead, filesChanged };
}
