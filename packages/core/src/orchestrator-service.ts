/**
 * OrchestratorService — explicit rule-based orchestration with Episode-first synthesis.
 */

import type {
  Session,
  SessionId,
  Message,
  MessagePart,
  TextPart,
  Episode,
} from "./types/index.js";
import {
  DEFAULT_EPISODE_SELECTION_POLICY,
  type EpisodeSelectionPolicy,
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
import { selectEpisodesForOrchestrator } from "./episode-selection.js";

const ORCHESTRATOR_SYSTEM_PROMPT = [
  "You are OpenSlate, a swarm-native coding agent.",
  "Follow the provided orchestration decision and synthesize from selected Episodes.",
  "Do not emit delegation fences in responses.",
  "When synthesizing, prioritize concrete findings, changed files, and open questions from Episodes.",
].join("\n");

const MAX_THREADS_PER_TURN = 3;
const PREFERRED_THREADS_PER_TURN = 2;
const DEFAULT_CHILD_MAX_ITERATIONS = 8;
const DEFAULT_DELEGATION_CAPABILITIES = ["read", "search"];

export interface DelegationPolicy {
  maxThreadsPerTurn: number;
  preferredThreadsPerTurn: number;
  childMaxIterations: number;
  defaultCapabilities: string[];
  episodeSelection: EpisodeSelectionPolicy;
}

export interface DelegationPlanEntry {
  alias: string;
  task: string;
  reason: string | null;
  expectedOutput: string | null;
  capabilities: string[];
  inputEpisodeIds: string[];
}

export interface DelegationPlan {
  id: string;
  createdAt: string;
  policy: DelegationPolicy;
  strategy:
    | "answer_directly"
    | "delegate"
    | "synthesize_from_episodes"
    | "ask_for_more_work";
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
  episodeId: string;
  inputEpisodeIds: string[];
  startedAt: string;
  finishedAt: string | null;
  delegationReason: string | null;
  expectedOutput: string | null;
  capabilities: string[];
  iterations: number;
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

type OrchestrationDecision =
  | { strategy: "answer_directly"; reason: string }
  | { strategy: "ask_for_more_work"; reason: string; clarification: string }
  | { strategy: "synthesize_from_episodes"; reason: string }
  | { strategy: "delegate"; reason: string; desiredChildren: number };

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

function looksLikeGreeting(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return /^(hi|hello|hey|yo|thanks|thank you|good morning|good evening)\b/.test(
    normalized,
  );
}

function looksLikeClarificationOnly(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (/^(continue|go on|more|again|help)$/.test(normalized)) return true;
  if (
    /^(can you|could you|would you)\s+(help|do this|work on this)\??$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function looksSimpleFactQuestion(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.endsWith("?")) return false;
  if (normalized.length > 80) return false;
  return !/(implement|fix|debug|read|inspect|search|update|refactor|test)/i.test(
    normalized,
  );
}

function shouldSynthesizeFromEpisodes(content: string): boolean {
  return /(summarize|recap|status|what happened|what did we learn)/i.test(content);
}

function inferDesiredChildren(content: string): number {
  const normalized = content.toLowerCase();
  const multiSignal =
    (normalized.match(/\band\b/g)?.length ?? 0) +
    (normalized.match(/\bthen\b/g)?.length ?? 0) +
    (normalized.match(/\balso\b/g)?.length ?? 0);

  if (multiSignal >= 2 || /\b(plan|implement|test|verify)\b/.test(normalized)) {
    return 2;
  }
  return 1;
}

function decideOrchestration(content: string): OrchestrationDecision {
  if (looksLikeGreeting(content) || looksSimpleFactQuestion(content)) {
    return {
      strategy: "answer_directly",
      reason: "Request is lightweight and can be answered directly.",
    };
  }

  if (looksLikeClarificationOnly(content)) {
    return {
      strategy: "ask_for_more_work",
      reason: "User request is underspecified for execution.",
      clarification:
        "Can you specify the concrete outcome you want (files, behavior, or bug) so I can execute it?",
    };
  }

  if (shouldSynthesizeFromEpisodes(content)) {
    return {
      strategy: "synthesize_from_episodes",
      reason: "User is asking for recap/synthesis work.",
    };
  }

  return {
    strategy: "delegate",
    reason: "Task benefits from bounded child execution.",
    desiredChildren: inferDesiredChildren(content),
  };
}

function inferCapabilities(task: string): string[] {
  const normalized = task.toLowerCase();
  const caps = new Set<string>(DEFAULT_DELEGATION_CAPABILITIES);

  if (/(edit|write|refactor|implement|fix|update|patch)/.test(normalized)) {
    caps.add("edit");
    caps.add("write");
  }
  if (/(test|run|build|lint|execute|repro)/.test(normalized)) {
    caps.add("terminal");
  }
  if (/(delete|remove)/.test(normalized)) {
    caps.add("delete");
  }

  return [...caps];
}

function inferAlias(task: string, index: number): string {
  const normalized = task.toLowerCase();
  if (/(test|verify|qa|regression)/.test(normalized)) return `qa-${index + 1}`;
  if (/(implement|fix|refactor|write)/.test(normalized)) {
    return `builder-${index + 1}`;
  }
  if (/(research|read|inspect|investigate|analyze)/.test(normalized)) {
    return `analyst-${index + 1}`;
  }
  return `worker-${index + 1}`;
}

function splitTask(content: string, desiredChildren: number): string[] {
  const rough = content
    .split(/\n+/)
    .flatMap((line) => line.split(/\b(?:then|also|and then)\b/i))
    .map((item) => item.trim())
    .filter(Boolean);

  if (rough.length === 0) return [content.trim()];
  if (rough.length === 1) return [rough[0]!];
  return rough.slice(0, desiredChildren);
}

function buildRuleDelegationPlan(input: {
  content: string;
  decision: Extract<OrchestrationDecision, { strategy: "delegate" }>;
  episodes: Episode[];
}): DelegationPlan {
  const policy: DelegationPolicy = {
    maxThreadsPerTurn: MAX_THREADS_PER_TURN,
    preferredThreadsPerTurn: PREFERRED_THREADS_PER_TURN,
    childMaxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
    defaultCapabilities: [...DEFAULT_DELEGATION_CAPABILITIES],
    episodeSelection: DEFAULT_EPISODE_SELECTION_POLICY,
  };

  const desired = Math.min(
    Math.max(input.decision.desiredChildren, 1),
    policy.preferredThreadsPerTurn,
  );

  const tasks = splitTask(input.content, desired).slice(0, policy.maxThreadsPerTurn);

  const entries: DelegationPlanEntry[] = tasks.map((task, index) => {
    const selectedEpisodes = selectEpisodesForOrchestrator({
      episodes: input.episodes,
      task,
      limit: policy.episodeSelection.maxForChildPrompt,
    });

    return {
      alias: inferAlias(task, index),
      task,
      reason: input.decision.reason,
      expectedOutput:
        "Concrete result with files touched, key findings, open questions, and next actions.",
      capabilities: inferCapabilities(task),
      inputEpisodeIds: selectedEpisodes.map((episode) => episode.id),
    };
  });

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    policy,
    strategy: "delegate",
    entries,
  };
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
    summary: result.episode.summary ?? null,
    keyFindings: result.episode.keyFindings,
    filesRead: result.episode.filesRead,
    filesChanged: result.episode.filesChanged,
    toolCallCount: result.episode.runtime.toolCalls.length,
    durationMs: result.episode.runtime.durationMs,
    model: result.episode.runtime.model,
    tokenUsage: result.episode.runtime.tokenUsage,
    estimatedCostUsd: result.episode.runtime.estimatedCostUsd,
    completionContractValidity: result.episode.completionContract.validity,
    workerReturnId: result.workerReturn.id,
    episodeId: result.episode.id,
    inputEpisodeIds: result.episode.inputEpisodeIds,
    startedAt: result.workerReturn.startedAt,
    finishedAt: result.workerReturn.finishedAt,
    delegationReason: entry.reason,
    expectedOutput: entry.expectedOutput,
    capabilities: entry.capabilities,
    iterations: result.episode.runtime.iterations,
  };
}

function buildEpisodeSynthesisContext(episodes: Episode[], title: string): string {
  const lines: string[] = [
    `${title}:`,
    "Use only this selected Episode context; do not rely on raw child transcripts.",
  ];

  if (episodes.length === 0) {
    lines.push("(no episodes selected)");
    return lines.join("\n");
  }

  for (const episode of episodes) {
    lines.push("---");
    lines.push(`Episode: ${episode.id}`);
    lines.push(`WorkerReturn: ${episode.workerReturnId}`);
    lines.push(`Alias: ${episode.alias ?? "(none)"}`);
    lines.push(`Task: ${episode.task}`);
    lines.push(`Status: ${episode.status}`);
    lines.push(`Summary: ${episode.summary ?? "(none)"}`);
    lines.push(
      `Key Findings: ${episode.keyFindings.length > 0 ? episode.keyFindings.join(" | ") : "(none)"}`,
    );
    lines.push(
      `Files Changed: ${episode.filesChanged.length > 0 ? episode.filesChanged.join(" | ") : "(none)"}`,
    );
    lines.push(
      `Files Read: ${episode.filesRead.length > 0 ? episode.filesRead.join(" | ") : "(none)"}`,
    );
    lines.push(
      `Open Questions: ${episode.openQuestions.length > 0 ? episode.openQuestions.join(" | ") : "(none)"}`,
    );
    lines.push(
      `Next Actions: ${episode.nextActions.length > 0 ? episode.nextActions.join(" | ") : "(none)"}`,
    );
    lines.push(
      `Runtime: iterations=${episode.runtime.iterations}, toolCalls=${episode.runtime.toolCalls.length}, durationMs=${episode.runtime.durationMs ?? "unknown"}, model=${episode.runtime.model ?? "unknown"}`,
    );
  }

  return lines.join("\n");
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
      events.emit(RuntimeEvents.messageCreated(sessionId, userMessage.id, "user"));

      const baseSystemPrompt = combineSystemPrompt(systemPrompt);
      const priorEpisodes = threadService.listEpisodes(sessionId);
      const decision = decideOrchestration(content);

      if (decision.strategy === "ask_for_more_work") {
        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "text", content: decision.clarification }],
        });
        events.emit(
          RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"),
        );
        events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));
        return {
          userMessage,
          assistantMessage,
          threadRuns: [],
          delegationPlan: {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            strategy: "ask_for_more_work",
            policy: {
              maxThreadsPerTurn: MAX_THREADS_PER_TURN,
              preferredThreadsPerTurn: PREFERRED_THREADS_PER_TURN,
              childMaxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
              defaultCapabilities: [...DEFAULT_DELEGATION_CAPABILITIES],
              episodeSelection: DEFAULT_EPISODE_SELECTION_POLICY,
            },
            entries: [],
          },
          usage: null,
        };
      }

      if (decision.strategy === "answer_directly") {
        const history = messageStore.listBySession(sessionId);
        events.emit(RuntimeEvents.assistantStarted(sessionId));
        const result = await modelCall({
          messages: toModelMessages(history),
          system: `${baseSystemPrompt}\n\nRule decision: answer directly without delegation.`,
        });

        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: result.parts,
        });
        events.emit(
          RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"),
        );
        events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

        return {
          userMessage,
          assistantMessage,
          threadRuns: [],
          delegationPlan: {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            strategy: "answer_directly",
            policy: {
              maxThreadsPerTurn: MAX_THREADS_PER_TURN,
              preferredThreadsPerTurn: PREFERRED_THREADS_PER_TURN,
              childMaxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
              defaultCapabilities: [...DEFAULT_DELEGATION_CAPABILITIES],
              episodeSelection: DEFAULT_EPISODE_SELECTION_POLICY,
            },
            entries: [],
          },
          usage: result.usage ?? null,
        };
      }

      if (decision.strategy === "synthesize_from_episodes") {
        const selected = selectEpisodesForOrchestrator({
          episodes: priorEpisodes,
          task: content,
          limit: DEFAULT_EPISODE_SELECTION_POLICY.maxForOrchestrator,
        });

        const history = messageStore.listBySession(sessionId);
        events.emit(RuntimeEvents.assistantStarted(sessionId));
        const synthResult = await modelCall({
          messages: [
            ...toModelMessages(history),
            {
              role: "system",
              content: buildEpisodeSynthesisContext(
                selected,
                "Selected Episodes for synthesis",
              ),
            },
          ],
          system:
            `${baseSystemPrompt}\n\nRule decision: synthesize from selected episodes; do not delegate.`,
        });

        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: synthResult.parts,
        });
        events.emit(
          RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"),
        );
        events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

        return {
          userMessage,
          assistantMessage,
          threadRuns: [],
          delegationPlan: {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            strategy: "synthesize_from_episodes",
            policy: {
              maxThreadsPerTurn: MAX_THREADS_PER_TURN,
              preferredThreadsPerTurn: PREFERRED_THREADS_PER_TURN,
              childMaxIterations: DEFAULT_CHILD_MAX_ITERATIONS,
              defaultCapabilities: [...DEFAULT_DELEGATION_CAPABILITIES],
              episodeSelection: DEFAULT_EPISODE_SELECTION_POLICY,
            },
            entries: [],
          },
          usage: synthResult.usage ?? null,
        };
      }

      const delegationPlan = buildRuleDelegationPlan({
        content,
        decision,
        episodes: priorEpisodes,
      });

      const threadRuns: ThreadRunCard[] = [];
      const handoffEpisodeIds: string[] = [];

      for (const entry of delegationPlan.entries.slice(0, MAX_THREADS_PER_TURN)) {
        const inputEpisodeIds = [
          ...entry.inputEpisodeIds,
          ...handoffEpisodeIds.slice(-2),
        ].filter((id, idx, arr) => arr.indexOf(id) === idx);

        const spawnInput: SpawnThreadInput = {
          parentSessionId: sessionId,
          alias: entry.alias,
          task: entry.task,
          capabilities: entry.capabilities,
          inputEpisodeIds,
          maxIterations: delegationPlan.policy.childMaxIterations,
        };

        try {
          const run = await threadService.spawnAndRun(spawnInput);
          const card = threadResultToCard(run, {
            ...entry,
            inputEpisodeIds,
          });
          threadRuns.push(card);
          handoffEpisodeIds.push(run.episode.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const now = new Date().toISOString();
          threadRuns.push({
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
            workerReturnId: `dispatch-error-${Date.now()}`,
            episodeId: `dispatch-error-episode-${Date.now()}`,
            inputEpisodeIds,
            startedAt: now,
            finishedAt: now,
            delegationReason: entry.reason,
            expectedOutput: entry.expectedOutput,
            capabilities: entry.capabilities,
            iterations: 0,
          });
        }
      }

      const planParts: MessagePart[] = [
        {
          kind: "text",
          content: "Executing rule-based delegation plan and synthesizing from Episodes.",
        },
        {
          kind: "delegation_plan",
          planId: delegationPlan.id,
          policy: delegationPlan.policy,
          entries: delegationPlan.entries,
        },
      ];

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
        RuntimeEvents.messageCreated(sessionId, intermediateAssistant.id, "assistant"),
      );

      const updatedEpisodes = threadService.listEpisodes(sessionId);
      const selectedForSynthesis = selectEpisodesForOrchestrator({
        episodes: updatedEpisodes,
        task: content,
        limit: DEFAULT_EPISODE_SELECTION_POLICY.maxForOrchestrator,
      });

      const historyForPhase2 = messageStore.listBySession(sessionId);
      const synthesisContext = buildEpisodeSynthesisContext(
        selectedForSynthesis,
        "Selected Episodes for final synthesis",
      );
      const phase2Input: ModelCallInput = {
        messages: [
          ...toModelMessages(historyForPhase2),
          { role: "system", content: synthesisContext },
        ],
        system:
          `${baseSystemPrompt}\n\nRule decision: delegate complete; synthesize final response from selected Episodes.`,
      };

      events.emit(RuntimeEvents.assistantStarted(sessionId));
      const phase2Result = await modelCall(phase2Input);

      const assistantMessage = messageStore.append({
        sessionId,
        role: "assistant",
        parts: phase2Result.parts,
      });
      events.emit(
        RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"),
      );
      events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

      sessionStore.touch(sessionId);
      events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

      return {
        userMessage,
        assistantMessage,
        threadRuns,
        delegationPlan,
        usage: phase2Result.usage ?? null,
      };
    },
  };
}
