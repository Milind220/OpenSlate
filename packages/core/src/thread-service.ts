/**
 * ThreadService — orchestrates child thread spawn, reuse, execution, and reintegration.
 *
 * This is the core swarm-native runtime service.
 * It coordinates:
 * - creating or reusing child thread sessions by alias
 * - running the bounded child runtime loop
 * - persisting WorkerReturn objects
 * - emitting thread lifecycle events
 */

import type { Session, SessionId } from "./types/index.js";
import type { WorkerReturn } from "./types/worker-return.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { WorkerReturnStore } from "./storage/worker-return-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";
import type { ChildModelCallFn, ToolExecutorFn } from "./child-runtime.js";
import { runChildLoop } from "./child-runtime.js";

// ── Types ────────────────────────────────────────────────────────────

export interface SpawnThreadInput {
  parentSessionId: SessionId;
  task: string;
  alias?: string;
  capabilities?: string[];
  systemPrompt?: string;
  maxIterations?: number;
}

export interface SpawnThreadResult {
  childSession: Session;
  workerReturn: WorkerReturn;
  reused: boolean;
}

export interface ThreadService {
  /** Spawn or reuse a child thread, run it, and return the structured result. */
  spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult>;
  /** List child sessions for a parent. */
  listChildren(parentSessionId: SessionId): Session[];
  /** List worker returns for a parent. */
  listWorkerReturns(parentSessionId: SessionId): WorkerReturn[];
  /** Get a specific worker return. */
  getWorkerReturn(id: string): WorkerReturn | null;
}

export interface ThreadServiceDeps {
  sessionStore: SessionStore;
  messageStore: MessageStore;
  workerReturnStore: WorkerReturnStore;
  events: EventBus;
  /** Model call function for child threads (uses "execute" slot). */
  childModelCall: ChildModelCallFn;
  /** Tool executor with capability checking. */
  createToolExecutor: (capabilities: string[]) => ToolExecutorFn;
  /** Tool definitions filtered by capabilities. */
  getToolSet: (capabilities: string[]) => Record<string, { description: string; parameters: Record<string, unknown> }>;
}

// ── Implementation ───────────────────────────────────────────────────

export function createThreadService(deps: ThreadServiceDeps): ThreadService {
  const {
    sessionStore, messageStore, workerReturnStore, events,
    childModelCall, createToolExecutor, getToolSet,
  } = deps;

  return {
    async spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult> {
      const {
        parentSessionId, task, alias, capabilities = ["read", "search"],
        systemPrompt, maxIterations,
      } = input;

      // 1. Validate parent exists
      const parent = sessionStore.get(parentSessionId);
      if (!parent) {
        throw new Error("Parent session not found: " + parentSessionId);
      }

      // 2. Resolve child session — reuse by alias or create new
      let childSession: Session;
      let reused = false;

      if (alias) {
        const existing = sessionStore.findByAlias(parentSessionId, alias);
        if (existing) {
          childSession = existing;
          reused = true;
          events.emit(RuntimeEvents.threadReused(parentSessionId, childSession.id, alias, task));
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
          events.emit(RuntimeEvents.threadCreated(parentSessionId, childSession.id, alias, task));
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
        events.emit(RuntimeEvents.threadCreated(parentSessionId, childSession.id, null, task));
      }

      // 3. Build tool set for allowed capabilities
      const tools = getToolSet(capabilities);
      const executeTool = createToolExecutor(capabilities);

      // 4. Run bounded child loop
      const startedAt = new Date().toISOString();
      events.emit(RuntimeEvents.threadStarted(childSession.id, task));

      let runResult;
      try {
        runResult = await runChildLoop(
          {
            childSessionId: childSession.id,
            task,
            systemPrompt,
            tools,
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

        // Still produce a WorkerReturn for failed runs
        const workerReturn = workerReturnStore.create({
          parentSessionId,
          childSessionId: childSession.id,
          childType: "thread",
          alias: alias ?? null,
          task,
          status: "aborted",
          output: "Child thread failed: " + error,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        events.emit(RuntimeEvents.workerReturnCreated(
          workerReturn.id, parentSessionId, childSession.id, "aborted",
        ));

        return { childSession, workerReturn, reused };
      }

      // 5. Update child session status
      const finalStatus = runResult.status === "completed" ? "completed" : "failed";
      sessionStore.updateStatus(childSession.id, finalStatus as any);

      // 6. Persist WorkerReturn
      const workerReturnStatus = runResult.status === "completed" ? "completed"
        : runResult.status === "aborted" ? "aborted" : "aborted";

      const workerReturn = workerReturnStore.create({
        parentSessionId,
        childSessionId: childSession.id,
        childType: "thread",
        alias: alias ?? null,
        task,
        status: workerReturnStatus,
        output: runResult.output,
        traceRef: childSession.id,
        startedAt,
        finishedAt: new Date().toISOString(),
      });

      events.emit(RuntimeEvents.workerReturnCreated(
        workerReturn.id, parentSessionId, childSession.id, workerReturnStatus,
      ));

      if (runResult.status === "completed") {
        events.emit(RuntimeEvents.threadCompleted(childSession.id, workerReturn.id));
      } else {
        events.emit(RuntimeEvents.threadFailed(childSession.id, runResult.output));
      }

      sessionStore.touch(parentSessionId);

      return { childSession, workerReturn, reused };
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
  };
}
