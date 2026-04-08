/**
 * OrchestratorService — the central orchestrator for automatic delegation.
 *
 * Wraps the parent model call + thread service to enable the parent to
 * automatically delegate work to child threads when appropriate.
 *
 * The orchestrator uses a two-phase approach:
 * Phase 1: Ask the parent model to respond. The model can either:
 *   a) Respond directly with text (no delegation needed)
 *   b) Include delegation blocks in its response (structured JSON fenced blocks)
 * Phase 2: If delegations were requested, spawn/reuse threads, collect results,
 *          then ask the parent model to synthesize a final response.
 */

import type { Session, SessionId, Message, MessagePart, TextPart } from "./types/index.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";
import type { ModelCallFn, ModelCallInput, ModelCallResult } from "./session-service.js";
import type { ThreadService, SpawnThreadInput, SpawnThreadResult } from "./thread-service.js";

const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are OpenSlate, a swarm-native coding agent.",
  "You can delegate tactical work to child threads when useful.",
  "To delegate, include a fenced JSON block using the delegate fence exactly:",
  "```delegate",
  "[{\"alias\": \"code-reader\", \"task\": \"Read and summarize the main entry point\"}]",
  "```",
  "The delegate block MUST be an array of objects with:",
  "- alias: string",
  "- task: string",
  "Only delegate when decomposition or parallel execution materially helps.",
  "For simple prompts, answer directly with no delegate block.",
  "After delegation results come back, synthesize a clear final answer that incorporates child work.",
  "Keep delegations bounded: at most 1-2 threads per turn.",
  "Prefer narrower, faster child tasks over broad scans.",
].join("\n");

const MAX_THREADS_PER_TURN = 2;
const DEFAULT_CHILD_MAX_ITERATIONS = 8;

interface DelegationRequest {
  alias: string;
  task: string;
}

// ThreadRunCard — structured representation of a thread run for the TUI
export interface ThreadRunCard {
  alias: string | null;
  task: string;
  childSessionId: SessionId;
  status: "completed" | "aborted" | "escalated";
  reused: boolean;
  output: string | null;
  workerReturnId: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface OrchestratorResult {
  userMessage: Message;
  /** The final assistant message (synthesis after delegation, or direct response) */
  assistantMessage: Message;
  /** Thread runs that happened during this turn, in order */
  threadRuns: ThreadRunCard[];
  /** Token usage for the orchestrator's own model calls */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface OrchestratorService {
  sendMessage(sessionId: SessionId, content: string): Promise<OrchestratorResult>;
}

export interface OrchestratorServiceDeps {
  sessionStore: SessionStore;
  messageStore: MessageStore;
  events: EventBus;
  modelCall: ModelCallFn;
  threadService: ThreadService;
  systemPrompt?: string;
}

function toModelMessages(history: Message[]): Array<{ role: string; content: string }> {
  return history.map((msg) => ({
    role: msg.role,
    content: msg.parts
      .filter((p): p is TextPart => p.kind === "text")
      .map((p) => p.content)
      .join("\n"),
  }));
}

function extractText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.content)
    .join("\n")
    .trim();
}

function formatOutputPreview(output: string | null, max = 240): string {
  if (!output) return "(no output)";
  if (output.length <= max) return output;
  return output.slice(0, max) + "…";
}

function combineSystemPrompt(systemPrompt?: string): string {
  if (systemPrompt && systemPrompt.trim().length > 0) {
    return `${systemPrompt.trim()}\n\n${ORCHESTRATOR_SYSTEM_PROMPT}`;
  }
  return ORCHESTRATOR_SYSTEM_PROMPT;
}

function mergeUsage(
  a?: ModelCallResult["usage"],
  b?: ModelCallResult["usage"],
): ModelCallResult["usage"] | null {
  if (!a && !b) return null;
  const promptTokens = (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0);
  const completionTokens = (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0);
  const totalTokens = (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0);
  return { promptTokens, completionTokens, totalTokens };
}

function buildSynthesisContext(threadRuns: ThreadRunCard[]): string {
  const lines: string[] = [
    "The following child threads completed. Incorporate their results into your response:",
  ];

  for (const run of threadRuns) {
    const label = run.alias ?? run.childSessionId;
    const preview = formatOutputPreview(run.output, 320);
    lines.push(`Thread [${label}]: ${run.status} — ${preview}`);
  }

  return lines.join("\n");
}

function parseDelegations(text: string): { delegations: DelegationRequest[]; cleanText: string } {
  const pattern = /```delegate\n([\s\S]*?)```/g;
  const delegations: DelegationRequest[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;

      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;

        const maybeAlias = (item as Record<string, unknown>).alias;
        const maybeTask = (item as Record<string, unknown>).task;

        if (typeof maybeAlias === "string" && typeof maybeTask === "string") {
          const alias = maybeAlias.trim();
          const task = maybeTask.trim();
          if (alias.length > 0 && task.length > 0) {
            delegations.push({ alias, task });
          }
        }
      }
    } catch {
      // Ignore malformed delegate blocks; model text remains usable.
    }
  }

  const cleanText = text.replace(pattern, "").trim();
  return { delegations, cleanText };
}

function stripDelegateBlocks(parts: MessagePart[]): MessagePart[] {
  return parts.map((part) => {
    if (part.kind !== "text") return part;

    const parsed = parseDelegations(part.content);
    if (parsed.cleanText.length > 0) {
      return { kind: "text", content: parsed.cleanText } satisfies TextPart;
    }

    return {
      kind: "text",
      content: "Delegation plan executed. Returning synthesized results.",
    } satisfies TextPart;
  });
}

function threadResultToCard(result: SpawnThreadResult): ThreadRunCard {
  return {
    alias: result.workerReturn.alias,
    task: result.workerReturn.task,
    childSessionId: result.workerReturn.childSessionId,
    status: result.workerReturn.status,
    reused: result.reused,
    output: result.workerReturn.output,
    workerReturnId: result.workerReturn.id,
    startedAt: result.workerReturn.startedAt,
    finishedAt: result.workerReturn.finishedAt,
  };
}

export function createOrchestratorService(deps: OrchestratorServiceDeps): OrchestratorService {
  const {
    sessionStore,
    messageStore,
    events,
    modelCall,
    threadService,
    systemPrompt,
  } = deps;

  return {
    async sendMessage(sessionId: SessionId, content: string): Promise<OrchestratorResult> {
      const session: Session | null = sessionStore.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const userMessage = messageStore.append({
        sessionId,
        role: "user",
        parts: [{ kind: "text", content }],
      });
      events.emit(RuntimeEvents.messageCreated(sessionId, userMessage.id, "user"));

      const baseSystemPrompt = combineSystemPrompt(systemPrompt);

      const historyForPhase1 = messageStore.listBySession(sessionId);
      const phase1Input: ModelCallInput = {
        messages: toModelMessages(historyForPhase1),
        system: baseSystemPrompt,
      };

      events.emit(RuntimeEvents.assistantStarted(sessionId));

      let phase1Result: ModelCallResult;
      try {
        phase1Result = await modelCall(phase1Input);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Model call failed";
        const failed = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "status", content: `error: ${message}` }],
        });
        events.emit(RuntimeEvents.messageCreated(sessionId, failed.id, "assistant"));
        events.emit(RuntimeEvents.assistantFailed(sessionId, failed.id, message));
        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));
        throw error;
      }

      const phase1Text = extractText(phase1Result.parts);
      const { delegations, cleanText } = parseDelegations(phase1Text);

      if (delegations.length === 0) {
        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: phase1Result.parts,
        });
        events.emit(RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"));
        events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

        return {
          userMessage,
          assistantMessage,
          threadRuns: [],
          usage: phase1Result.usage ?? null,
        };
      }

      const boundedDelegations = delegations.slice(0, MAX_THREADS_PER_TURN);
      const threadRuns = await Promise.all(
        boundedDelegations.map(async (delegation, i): Promise<ThreadRunCard> => {
          const spawnInput: SpawnThreadInput = {
            parentSessionId: sessionId,
            alias: delegation.alias,
            task: delegation.task,
            maxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
          };

          try {
            const runResult = await threadService.spawnAndRun(spawnInput);
            return threadResultToCard(runResult);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const now = new Date().toISOString();
            return {
              alias: delegation.alias,
              task: delegation.task,
              childSessionId: sessionId,
              status: "aborted",
              reused: false,
              output: `Thread dispatch failed: ${message}`,
              workerReturnId: `dispatch-error-${i + 1}-${Date.now()}`,
              startedAt: now,
              finishedAt: now,
            };
          }
        }),
      );

      const planParts: MessagePart[] = [];
      if (cleanText.length > 0) {
        planParts.push({ kind: "text", content: cleanText });
      } else {
        planParts.push({ kind: "text", content: "Delegating to child threads and collecting results." });
      }

      for (const run of threadRuns) {
        if (!run.workerReturnId.startsWith("dispatch-error-")) {
          planParts.push({ kind: "worker_return_ref", workerReturnId: run.workerReturnId });
        }
      }

      const intermediateAssistant = messageStore.append({
        sessionId,
        role: "assistant",
        parts: planParts,
      });
      events.emit(RuntimeEvents.messageCreated(sessionId, intermediateAssistant.id, "assistant"));

      const historyForPhase2 = messageStore.listBySession(sessionId);
      const synthesisContext = buildSynthesisContext(threadRuns);
      const phase2Input: ModelCallInput = {
        messages: [
          ...toModelMessages(historyForPhase2),
          { role: "system", content: synthesisContext },
        ],
        system: baseSystemPrompt,
      };

      events.emit(RuntimeEvents.assistantStarted(sessionId));

      let phase2Result: ModelCallResult;
      try {
        phase2Result = await modelCall(phase2Input);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Model synthesis call failed";
        const failed = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "status", content: `error: ${message}` }],
        });
        events.emit(RuntimeEvents.messageCreated(sessionId, failed.id, "assistant"));
        events.emit(RuntimeEvents.assistantFailed(sessionId, failed.id, message));
        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));
        throw error;
      }

      const cleanedPhase2Parts = stripDelegateBlocks(phase2Result.parts);

      const assistantMessage = messageStore.append({
        sessionId,
        role: "assistant",
        parts: cleanedPhase2Parts,
      });
      events.emit(RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"));
      events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

      sessionStore.touch(sessionId);
      events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

      return {
        userMessage,
        assistantMessage,
        threadRuns,
        usage: mergeUsage(phase1Result.usage, phase2Result.usage),
      };
    },
  };
}

export { parseDelegations };
