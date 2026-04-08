/**
 * OrchestratorService — central orchestrator for automatic delegation.
 */

import type {
  Session,
  SessionId,
  Message,
  MessagePart,
  TextPart,
} from "./types/index.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";
import type {
  ModelCallFn,
  ModelCallInput,
  ModelCallResult,
} from "./session-service.js";
import type {
  ThreadService,
  SpawnThreadInput,
  SpawnThreadResult,
} from "./thread-service.js";

const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are OpenSlate, a swarm-native coding agent.",
  "Default behavior: if a request is anything beyond a very direct/simple response, delegate tactical work to child threads.",
  "Delegate aggressively for analysis, code reading, multi-step tasks, or anything that benefits from parallel execution.",
  "Do NOT delegate for: greetings, simple factual one-liners, or clarification questions that require no execution.",
  "Keep delegation bounded and focused: spawn 1-3 threads max per turn.",
  "Prefer narrow, high-signal thread tasks over broad exploratory scans.",
  "To delegate, include a fenced JSON block using the delegate fence exactly:",
  "```delegate",
  '[{"alias": "code-reader", "task": "Read and summarize the main entry point", "reason": "Need focused entrypoint analysis", "expectedOutput": "A concise summary with concrete files", "capabilities": ["read", "search"]}]',
  "```",
  "The delegate block MUST be an array of objects with alias + task. reason/expectedOutput/capabilities are optional but recommended.",
  "After delegation results come back, synthesize a clear final answer that incorporates child work and cites concrete findings.",
].join("\n");

const MAX_THREADS_PER_TURN = 3;
const DEFAULT_CHILD_MAX_ITERATIONS = 8;
const DEFAULT_DELEGATION_CAPABILITIES = ["read", "search"];

interface DelegationRequest {
  alias: string;
  task: string;
  reason: string | null;
  expectedOutput: string | null;
  capabilities: string[];
}

export interface DelegationPolicy {
  maxThreadsPerTurn: number;
  childMaxIterations: number;
  defaultCapabilities: string[];
}

export interface DelegationPlanEntry {
  alias: string;
  task: string;
  reason: string | null;
  expectedOutput: string | null;
  capabilities: string[];
}

export interface DelegationPlan {
  id: string;
  createdAt: string;
  policy: DelegationPolicy;
  entries: DelegationPlanEntry[];
}

export interface ThreadRunCard {
  alias: string | null;
  task: string;
  childSessionId: SessionId;
  status: "completed" | "aborted" | "escalated";
  reused: boolean;
  output: string | null;
  summary: string | null;
  keyFindings: string[];
  filesRead: string[];
  filesChanged: string[];
  toolCallCount: number;
  durationMs: number | null;
  model: string | null;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd: number | null;
  completionContractValidity: "valid" | "missing" | "malformed" | null;
  workerReturnId: string;
  startedAt: string;
  finishedAt: string | null;
  delegationReason: string | null;
  expectedOutput: string | null;
  capabilities: string[];
}

export interface OrchestratorResult {
  userMessage: Message;
  assistantMessage: Message;
  threadRuns: ThreadRunCard[];
  delegationPlan: DelegationPlan | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface OrchestratorService {
  sendMessage(
    sessionId: SessionId,
    content: string,
  ): Promise<OrchestratorResult>;
}

export interface OrchestratorServiceDeps {
  sessionStore: SessionStore;
  messageStore: MessageStore;
  events: EventBus;
  modelCall: ModelCallFn;
  threadService: ThreadService;
  systemPrompt?: string;
}

function toModelMessages(
  history: Message[],
): Array<{ role: string; content: string }> {
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
  const completionTokens =
    (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0);
  const totalTokens = (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0);
  return { promptTokens, completionTokens, totalTokens };
}

function buildSynthesisContext(threadRuns: ThreadRunCard[]): string {
  const lines: string[] = [
    "Child thread run context (WorkerReturn-first):",
    "Use this structured data directly when synthesizing the final response.",
  ];

  for (const run of threadRuns) {
    const label = run.alias ?? run.childSessionId;
    const findings = run.keyFindings.length > 0 ? run.keyFindings : ["(none)"];
    const filesRead = run.filesRead.length > 0 ? run.filesRead : ["(none)"];
    const filesChanged =
      run.filesChanged.length > 0 ? run.filesChanged : ["(none)"];

    lines.push("---");
    lines.push(`Thread: ${label}`);
    lines.push(`Task: ${run.task}`);
    lines.push(`Delegation Reason: ${run.delegationReason ?? "(none)"}`);
    lines.push(`Expected Output: ${run.expectedOutput ?? "(none)"}`);
    lines.push(`Capabilities: ${run.capabilities.join(", ") || "(none)"}`);
    lines.push(`Status: ${run.status}`);
    lines.push(
      `Completion Contract: ${run.completionContractValidity ?? "unknown"}`,
    );
    lines.push(`Summary: ${run.summary ?? "(none)"}`);
    lines.push(`Key Findings: ${findings.join(" | ")}`);
    lines.push(`Files Read: ${filesRead.join(" | ")}`);
    lines.push(`Files Changed: ${filesChanged.join(" | ")}`);
    lines.push(`Tool Calls: ${run.toolCallCount}`);
    lines.push(`Duration (ms): ${run.durationMs ?? "unknown"}`);
    lines.push(`Model: ${run.model ?? "unknown"}`);
    lines.push(
      `Token Usage: ${run.tokenUsage ? JSON.stringify(run.tokenUsage) : "unknown"}`,
    );
    lines.push(
      `Estimated Cost USD: ${run.estimatedCostUsd == null ? "unknown" : run.estimatedCostUsd}`,
    );
    lines.push(`Output Preview: ${formatOutputPreview(run.output, 320)}`);
  }

  return lines.join("\n");
}

export function parseDelegations(text: string): {
  delegations: DelegationRequest[];
  cleanText: string;
} {
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
        const maybeReason = (item as Record<string, unknown>).reason;
        const maybeExpectedOutput = (item as Record<string, unknown>)
          .expectedOutput;
        const maybeCapabilities = (item as Record<string, unknown>)
          .capabilities;

        if (typeof maybeAlias === "string" && typeof maybeTask === "string") {
          const alias = maybeAlias.trim();
          const task = maybeTask.trim();
          if (alias.length === 0 || task.length === 0) continue;

          delegations.push({
            alias,
            task,
            reason:
              typeof maybeReason === "string" && maybeReason.trim()
                ? maybeReason.trim()
                : null,
            expectedOutput:
              typeof maybeExpectedOutput === "string" &&
              maybeExpectedOutput.trim()
                ? maybeExpectedOutput.trim()
                : null,
            capabilities: Array.isArray(maybeCapabilities)
              ? maybeCapabilities.filter(
                  (x): x is string =>
                    typeof x === "string" && x.trim().length > 0,
                )
              : [],
          });
        }
      }
    } catch {
      // Ignore malformed delegate blocks.
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

function threadResultToCard(
  result: SpawnThreadResult,
  entry: DelegationPlanEntry,
): ThreadRunCard {
  return {
    alias: result.workerReturn.alias,
    task: result.workerReturn.task,
    childSessionId: result.workerReturn.childSessionId,
    status: result.workerReturn.status,
    reused: result.reused,
    output: result.workerReturn.output,
    summary: result.workerReturn.summary ?? null,
    keyFindings: result.workerReturn.keyFindings ?? [],
    filesRead: result.workerReturn.filesRead ?? [],
    filesChanged: result.workerReturn.filesChanged ?? [],
    toolCallCount: result.workerReturn.toolCalls?.length ?? 0,
    durationMs: result.workerReturn.durationMs ?? null,
    model: result.workerReturn.model ?? null,
    tokenUsage: result.workerReturn.tokenUsage ?? null,
    estimatedCostUsd: result.workerReturn.estimatedCostUsd ?? null,
    completionContractValidity:
      result.workerReturn.completionContract?.validity ?? null,
    workerReturnId: result.workerReturn.id,
    startedAt: result.workerReturn.startedAt,
    finishedAt: result.workerReturn.finishedAt,
    delegationReason: entry.reason,
    expectedOutput: entry.expectedOutput,
    capabilities: entry.capabilities,
  };
}

function createDelegationPlan(
  delegations: DelegationRequest[],
): DelegationPlan {
  const policy: DelegationPolicy = {
    maxThreadsPerTurn: MAX_THREADS_PER_TURN,
    childMaxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
    defaultCapabilities: [...DEFAULT_DELEGATION_CAPABILITIES],
  };

  const entries = delegations.slice(0, MAX_THREADS_PER_TURN).map((d) => ({
    alias: d.alias,
    task: d.task,
    reason: d.reason,
    expectedOutput: d.expectedOutput,
    capabilities:
      d.capabilities.length > 0
        ? d.capabilities
        : [...DEFAULT_DELEGATION_CAPABILITIES],
  }));

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    policy,
    entries,
  };
}

export function createOrchestratorService(
  deps: OrchestratorServiceDeps,
): OrchestratorService {
  const {
    sessionStore,
    messageStore,
    events,
    modelCall,
    threadService,
    systemPrompt,
  } = deps;

  return {
    async sendMessage(
      sessionId: SessionId,
      content: string,
    ): Promise<OrchestratorResult> {
      const session: Session | null = sessionStore.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const userMessage = messageStore.append({
        sessionId,
        role: "user",
        parts: [{ kind: "text", content }],
      });
      events.emit(
        RuntimeEvents.messageCreated(sessionId, userMessage.id, "user"),
      );

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
        const message =
          error instanceof Error ? error.message : "Model call failed";
        const failed = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "status", content: `error: ${message}` }],
        });
        events.emit(
          RuntimeEvents.messageCreated(sessionId, failed.id, "assistant"),
        );
        events.emit(
          RuntimeEvents.assistantFailed(sessionId, failed.id, message),
        );
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
        events.emit(
          RuntimeEvents.messageCreated(
            sessionId,
            assistantMessage.id,
            "assistant",
          ),
        );
        events.emit(
          RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id),
        );

        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

        return {
          userMessage,
          assistantMessage,
          threadRuns: [],
          delegationPlan: null,
          usage: phase1Result.usage ?? null,
        };
      }

      const delegationPlan = createDelegationPlan(delegations);

      const threadRuns = await Promise.all(
        delegationPlan.entries.map(async (entry, i): Promise<ThreadRunCard> => {
          const spawnInput: SpawnThreadInput = {
            parentSessionId: sessionId,
            alias: entry.alias,
            task: entry.task,
            capabilities: entry.capabilities,
            maxIterations: delegationPlan.policy.childMaxIterations,
          };

          try {
            const runResult = await threadService.spawnAndRun(spawnInput);
            return threadResultToCard(runResult, entry);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const now = new Date().toISOString();
            return {
              alias: entry.alias,
              task: entry.task,
              childSessionId: sessionId,
              status: "aborted",
              reused: false,
              output: `Thread dispatch failed: ${message}`,
              summary: "Thread dispatch failed",
              keyFindings: [message],
              filesRead: [],
              filesChanged: [],
              toolCallCount: 0,
              durationMs: null,
              model: null,
              tokenUsage: null,
              estimatedCostUsd: null,
              completionContractValidity: "missing",
              workerReturnId: `dispatch-error-${i + 1}-${Date.now()}`,
              startedAt: now,
              finishedAt: now,
              delegationReason: entry.reason,
              expectedOutput: entry.expectedOutput,
              capabilities: entry.capabilities,
            };
          }
        }),
      );

      const planParts: MessagePart[] = [];
      if (cleanText.length > 0) {
        planParts.push({ kind: "text", content: cleanText });
      } else {
        planParts.push({
          kind: "text",
          content: "Delegating to child threads and collecting results.",
        });
      }

      planParts.push({
        kind: "delegation_plan",
        planId: delegationPlan.id,
        policy: delegationPlan.policy,
        entries: delegationPlan.entries,
      });

      for (const run of threadRuns) {
        if (!run.workerReturnId.startsWith("dispatch-error-")) {
          planParts.push({
            kind: "worker_return_ref",
            workerReturnId: run.workerReturnId,
          });
        }
      }

      const intermediateAssistant = messageStore.append({
        sessionId,
        role: "assistant",
        parts: planParts,
      });
      events.emit(
        RuntimeEvents.messageCreated(
          sessionId,
          intermediateAssistant.id,
          "assistant",
        ),
      );

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
        const message =
          error instanceof Error
            ? error.message
            : "Model synthesis call failed";
        const failed = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "status", content: `error: ${message}` }],
        });
        events.emit(
          RuntimeEvents.messageCreated(sessionId, failed.id, "assistant"),
        );
        events.emit(
          RuntimeEvents.assistantFailed(sessionId, failed.id, message),
        );
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
      events.emit(
        RuntimeEvents.messageCreated(
          sessionId,
          assistantMessage.id,
          "assistant",
        ),
      );
      events.emit(
        RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id),
      );

      sessionStore.touch(sessionId);
      events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

      return {
        userMessage,
        assistantMessage,
        threadRuns,
        delegationPlan,
        usage: mergeUsage(phase1Result.usage, phase2Result.usage),
      };
    },
  };
}
