/**
 * ThreadService — orchestrates child thread spawn, reuse, execution, and reintegration.
 */

import type { Session, SessionId, Episode } from "./types/index.js";
import type { WorkerReturn } from "./types/worker-return.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { WorkerReturnStore } from "./storage/worker-return-store.js";
import type { EpisodeStore } from "./storage/episode-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";
import type {
  ChildModelCallFn,
  ToolExecutorFn,
  ChildRunResult,
} from "./child-runtime.js";
import { runChildLoop } from "./child-runtime.js";
import { selectEpisodesForChildPrompt } from "./episode-selection.js";
import { DEFAULT_EPISODE_SELECTION_POLICY } from "./types/index.js";

export interface SpawnThreadInput {
  parentSessionId: SessionId;
  task: string;
  alias?: string;
  capabilities?: string[];
  systemPrompt?: string;
  inputEpisodeIds?: string[];
  maxIterations?: number;
}

export interface SpawnThreadResult {
  childSession: Session;
  workerReturn: WorkerReturn;
  episode: Episode;
  inputEpisodeIds: string[];
  reused: boolean;
}

export interface ThreadService {
  spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult>;
  listChildren(parentSessionId: SessionId): Session[];
  listWorkerReturns(parentSessionId: SessionId): WorkerReturn[];
  getWorkerReturn(id: string): WorkerReturn | null;
  listEpisodes(parentSessionId: SessionId): Episode[];
  getEpisode(id: string): Episode | null;
}

export interface ThreadServiceDeps {
  sessionStore: SessionStore;
  messageStore: MessageStore;
  workerReturnStore: WorkerReturnStore;
  episodeStore: EpisodeStore;
  events: EventBus;
  childModelCall: ChildModelCallFn;
  createToolExecutor: (capabilities: string[]) => ToolExecutorFn;
  getToolSet: (
    capabilities: string[],
  ) => Record<
    string,
    { description: string; parameters: Record<string, unknown> }
  >;
}

export function createThreadService(deps: ThreadServiceDeps): ThreadService {
  const {
    sessionStore,
    messageStore,
    workerReturnStore,
    episodeStore,
    events,
    childModelCall,
    createToolExecutor,
    getToolSet,
  } = deps;

  return {
    async spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult> {
      const {
        parentSessionId,
        task,
        alias,
        capabilities = ["read", "search"],
        systemPrompt,
        inputEpisodeIds = [],
        maxIterations,
      } = input;

      const parent = sessionStore.get(parentSessionId);
      if (!parent) {
        throw new Error("Parent session not found: " + parentSessionId);
      }

      let childSession: Session;
      let reused = false;

      if (alias) {
        const existing = sessionStore.findByAlias(parentSessionId, alias);
        if (existing) {
          childSession = existing;
          reused = true;
          events.emit(
            RuntimeEvents.threadReused(
              parentSessionId,
              childSession.id,
              alias,
              task,
            ),
          );
        } else {
          childSession = sessionStore.create({
            projectId: parent.projectId,
            kind: "thread",
            parentId: parentSessionId,
            alias,
            title: alias,
            task,
            capabilities,
          });
          events.emit(
            RuntimeEvents.threadCreated(
              parentSessionId,
              childSession.id,
              alias,
              task,
            ),
          );
        }
      } else {
        childSession = sessionStore.create({
          projectId: parent.projectId,
          kind: "thread",
          parentId: parentSessionId,
          title: task.slice(0, 80),
          task,
          capabilities,
        });
        events.emit(
          RuntimeEvents.threadCreated(
            parentSessionId,
            childSession.id,
            null,
            task,
          ),
        );
      }

      const priorEpisodes = episodeStore.listByParent(parentSessionId);
      const selectedInputEpisodes = selectEpisodesForChildPrompt({
        episodes: priorEpisodes,
        task,
        alias: alias ?? childSession.alias,
        inputEpisodeIds,
        limit: DEFAULT_EPISODE_SELECTION_POLICY.maxForChildPrompt,
      });

      const tools = getToolSet(capabilities);
      const executeTool = createToolExecutor(capabilities);

      const startedAt = new Date().toISOString();
      events.emit(RuntimeEvents.threadStarted(childSession.id, task));

      let runResult: ChildRunResult;
      try {
        runResult = await runChildLoop(
          {
            childSessionId: childSession.id,
            task,
            systemPrompt,
            tools,
            inputEpisodes: selectedInputEpisodes,
            maxIterations,
          },
          {
            messageStore,
            events,
            modelCall: childModelCall,
            executeTool,
          },
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        sessionStore.updateStatus(childSession.id, "failed");
        events.emit(RuntimeEvents.threadFailed(childSession.id, error));

        const workerReturn = workerReturnStore.create({
          parentSessionId,
          childSessionId: childSession.id,
          childType: "thread",
          alias: alias ?? null,
          task,
          status: "aborted",
          output: "Child thread failed: " + error,
          traceRef: childSession.id,
          artifactRefs: [],
          startedAt,
          finishedAt: new Date().toISOString(),
        });

        events.emit(
          RuntimeEvents.workerReturnCreated(
            workerReturn.id,
            parentSessionId,
            childSession.id,
            workerReturn.status,
          ),
        );

        const failureRunResult: ChildRunResult = {
          status: "failed",
          output: "Child thread failed: " + error,
          iterations: 0,
          structuredReturn: {
            summary: "Child thread failed before completion",
            keyFindings: [error],
            filesRead: [],
            filesChanged: [],
            openQuestions: ["How should this child thread error be recovered?"],
            nextActions: [
              "Inspect child runtime and tool execution logs for the failing thread.",
            ],
          },
          completionContract: {
            validity: "missing",
            issues: [
              "Child runtime crashed before emitting completion contract.",
            ],
          },
          toolCalls: [],
          filesRead: [],
          filesChanged: [],
          durationMs: undefined,
          model: null,
          tokenUsage: null,
          estimatedCostUsd: null,
        };

        const episode = persistEpisodeFromRun({
          episodeStore,
          workerReturn,
          runResult: failureRunResult,
          inputEpisodeIds: selectedInputEpisodes.map((episode) => episode.id),
        });

        events.emit(
          RuntimeEvents.episodeCreated(
            episode.id,
            workerReturn.id,
            parentSessionId,
            childSession.id,
            episode.status,
          ),
        );

        return {
          childSession,
          workerReturn,
          episode,
          inputEpisodeIds: selectedInputEpisodes.map((episode) => episode.id),
          reused,
        };
      }

      const finalStatus =
        runResult.status === "completed"
          ? "completed"
          : runResult.status === "aborted"
            ? "aborted"
            : "failed";
      sessionStore.updateStatus(childSession.id, finalStatus as Session["status"]);

      const workerReturnStatus =
        runResult.status === "completed"
          ? "completed"
          : runResult.status === "aborted"
            ? "aborted"
            : "aborted";

      const workerReturn = workerReturnStore.create({
        parentSessionId,
        childSessionId: childSession.id,
        childType: "thread",
        alias: alias ?? null,
        task,
        status: workerReturnStatus,
        output: runResult.output,
        traceRef: childSession.id,
        artifactRefs: [],
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      events.emit(
        RuntimeEvents.workerReturnCreated(
          workerReturn.id,
          parentSessionId,
          childSession.id,
          workerReturn.status,
        ),
      );

      const episode = persistEpisodeFromRun({
        episodeStore,
        workerReturn,
        runResult,
        inputEpisodeIds: selectedInputEpisodes.map((item) => item.id),
      });

      events.emit(
        RuntimeEvents.episodeCreated(
          episode.id,
          workerReturn.id,
          parentSessionId,
          childSession.id,
          episode.status,
        ),
      );

      if (runResult.status === "completed") {
        events.emit(RuntimeEvents.threadCompleted(childSession.id, workerReturn.id));
      } else {
        events.emit(RuntimeEvents.threadFailed(childSession.id, runResult.output));
      }

      sessionStore.touch(parentSessionId);

      return {
        childSession,
        workerReturn,
        episode,
        inputEpisodeIds: selectedInputEpisodes.map((item) => item.id),
        reused,
      };
    },

    listChildren(parentSessionId: SessionId): Session[] {
      return sessionStore.listChildren(parentSessionId);
    },

    listWorkerReturns(parentSessionId: SessionId): WorkerReturn[] {
      return workerReturnStore.listByParent(parentSessionId);
    },

    getWorkerReturn(id: string): WorkerReturn | null {
      return workerReturnStore.get(id);
    },

    listEpisodes(parentSessionId: SessionId): Episode[] {
      return episodeStore.listByParent(parentSessionId);
    },

    getEpisode(id: string): Episode | null {
      return episodeStore.get(id);
    },
  };
}

function persistEpisodeFromRun(input: {
  episodeStore: EpisodeStore;
  workerReturn: WorkerReturn;
  runResult: ChildRunResult;
  inputEpisodeIds: string[];
}): Episode {
  const { episodeStore, workerReturn, runResult, inputEpisodeIds } = input;
  const summary =
    runResult.structuredReturn?.summary ?? deriveSummaryFromOutput(runResult.output);

  const keyFindings = runResult.structuredReturn?.keyFindings ?? [];
  const filesRead =
    runResult.filesRead.length > 0
      ? runResult.filesRead
      : runResult.structuredReturn?.filesRead ?? [];
  const filesChanged =
    runResult.filesChanged.length > 0
      ? runResult.filesChanged
      : runResult.structuredReturn?.filesChanged ?? [];
  const openQuestions = runResult.structuredReturn?.openQuestions ?? [];
  const nextActions = runResult.structuredReturn?.nextActions ?? [];

  return episodeStore.create({
    parentSessionId: workerReturn.parentSessionId,
    childSessionId: workerReturn.childSessionId,
    workerReturnId: workerReturn.id,
    childType: workerReturn.childType,
    alias: workerReturn.alias,
    task: workerReturn.task,
    status: workerReturn.status,
    traceRef: workerReturn.traceRef,
    artifactRefs: workerReturn.artifactRefs,
    inputEpisodeIds,
    summary,
    keyFindings,
    filesRead,
    filesChanged,
    openQuestions,
    nextActions,
    completionContract: runResult.completionContract,
    runtime: {
      iterations: runResult.iterations,
      structuredReturn: runResult.structuredReturn ?? null,
      completionContract: runResult.completionContract,
      toolCalls: runResult.toolCalls,
      filesRead: runResult.filesRead,
      filesChanged: runResult.filesChanged,
      durationMs: runResult.durationMs ?? null,
      model: runResult.model ?? null,
      tokenUsage: runResult.tokenUsage ?? null,
      estimatedCostUsd: runResult.estimatedCostUsd ?? null,
    },
    startedAt: workerReturn.startedAt,
    finishedAt: workerReturn.finishedAt,
  });
}

function deriveSummaryFromOutput(output: string): string | null {
  if (!output || !output.trim()) return null;
  const line = output
    .replace(/```worker_return[\s\S]*?```/gi, "")
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.length > 0);
  if (!line) return null;
  return line.length > 240 ? line.slice(0, 239) + "…" : line;
}
