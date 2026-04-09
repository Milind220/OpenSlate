import { describe, test, expect, beforeEach } from "bun:test";
import { initDatabase } from "./storage/database.js";
import { createSessionStore } from "./storage/session-store.js";
import { createMessageStore } from "./storage/message-store.js";
import { createWorkerReturnStore } from "./storage/worker-return-store.js";
import { createEpisodeStore } from "./storage/episode-store.js";
import { createEventBus } from "./events.js";
import { createOrchestratorService } from "./orchestrator-service.js";
import { createThreadService } from "./thread-service.js";
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
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { WorkerReturnStore } from "./storage/worker-return-store.js";
import type { EpisodeStore } from "./storage/episode-store.js";
import type { EventBus, OpenSlateEvent } from "./events.js";
import type { SessionId } from "./types/session.js";
import type { ChildToolCall } from "./child-runtime.js";

let db: ReturnType<typeof initDatabase>;
let sessionStore: SessionStore;
let messageStore: MessageStore;
let workerReturnStore: WorkerReturnStore;
let episodeStore: EpisodeStore;
let events: EventBus;
let emittedEvents: OpenSlateEvent[];

beforeEach(() => {
  db = initDatabase(":memory:");
  sessionStore = createSessionStore(db);
  messageStore = createMessageStore(db);
  workerReturnStore = createWorkerReturnStore(db);
  episodeStore = createEpisodeStore(db);
  events = createEventBus();
  emittedEvents = [];
  events.on((e) => emittedEvents.push(e));
});

function mockModelCallFn(response: string): ModelCallFn {
  return async (_input: ModelCallInput): Promise<ModelCallResult> => ({
    parts: [{ kind: "text", content: response }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  });
}

function mockThreadService(): ThreadService {
  return createThreadService({
    sessionStore,
    messageStore,
    workerReturnStore,
    episodeStore,
    events,
    childModelCall: async () => ({
      text: "Task complete.",
      toolCalls: [],
      finishReason: "stop",
    }),
    createToolExecutor: () => async (call: ChildToolCall) => ({
      toolCallId: call.id,
      toolName: call.name,
      content: "mock",
      isError: false,
    }),
    getToolSet: () => ({}),
  });
}

function createTestEpisode(args: {
  parentSessionId: SessionId;
  childSessionId: SessionId;
  workerReturnId: string;
  task: string;
  alias?: string;
  inputEpisodeIds?: string[];
}) {
  const now = new Date().toISOString();
  return episodeStore.create({
    parentSessionId: args.parentSessionId,
    childSessionId: args.childSessionId,
    workerReturnId: args.workerReturnId,
    childType: "thread",
    alias: args.alias ?? null,
    task: args.task,
    status: "completed",
    inputEpisodeIds: args.inputEpisodeIds ?? [],
    summary: "ok",
    completionContract: {
      validity: "valid",
      issues: [],
    },
    runtime: {
      iterations: 1,
      structuredReturn: null,
      completionContract: {
        validity: "valid",
        issues: [],
      },
      toolCalls: [],
      filesRead: [],
      filesChanged: [],
      durationMs: 1,
      model: null,
      tokenUsage: null,
      estimatedCostUsd: null,
    },
    startedAt: now,
    finishedAt: now,
  });
}
describe("OrchestratorService", () => {
  test("sendMessage with no delegation returns direct response", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockModelCallFn("Direct answer"),
      threadService: mockThreadService(),
    });

    const result = await orchestrator.sendMessage(parent.id, "Hello");

    expect(result.threadRuns).toEqual([]);
    expect(result.assistantMessage.parts[0]).toEqual({
      kind: "text",
      content: "Direct answer",
    });

    const persisted = messageStore.listBySession(parent.id);
    expect(persisted.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(
      (persisted[0]?.parts[0] as { kind: string; content: string }).content,
    ).toBe("Hello");
  });

  test("sendMessage with delegation spawns threads and synthesizes", async () => {
    const parent = sessionStore.create({ kind: "primary" });
    const synthesis = "Here is the synthesis based on thread results.";

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockModelCallFn(synthesis),
      threadService: mockThreadService(),
    });

    const result = await orchestrator.sendMessage(
      parent.id,
      "Do something complex",
    );

    expect(result.threadRuns).toHaveLength(1);
    expect(result.threadRuns[0]?.status).toBe("completed");
    expect(result.threadRuns[0]?.alias).toBe("worker-1");
    expect(result.assistantMessage.parts[0]).toEqual({
      kind: "text",
      content: synthesis,
    });
  });

  test("delegation path persists an intermediate delegation plan message", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockModelCallFn("Synthesizing from child output."),
      threadService: mockThreadService(),
    });

    await orchestrator.sendMessage(parent.id, "Do something complex");

    const persisted = messageStore.listBySession(parent.id);
    expect(persisted).toHaveLength(3);
    const intermediate = persisted[1];
    expect(intermediate?.role).toBe("assistant");
    expect(intermediate?.parts.some((part) => part.kind === "delegation_plan")).toBe(
      true,
    );
  });

  test("handles thread failure gracefully (non-fatal)", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const failingThreadService: ThreadService = {
      async spawnAndRun(_input: SpawnThreadInput): Promise<SpawnThreadResult> {
        throw new Error("Thread crashed");
      },
      listChildren(_parentSessionId: SessionId) {
        return [];
      },
      listWorkerReturns(_parentSessionId: SessionId) {
        return [];
      },
      getWorkerReturn(_id: string) {
        return null;
      },
      listEpisodes(_parentSessionId: SessionId) {
        return [];
      },
      getEpisode(_id: string) {
        return null;
      },
    };

    const phase2 = "Synthesis despite failure.";

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockModelCallFn(phase2),
      threadService: failingThreadService,
    });

    const result = await orchestrator.sendMessage(parent.id, "Try anyway");

    expect(result.threadRuns).toHaveLength(1);
    expect(result.threadRuns[0]?.status).toBe("aborted");
    expect(result.threadRuns[0]?.output).toContain("Thread crashed");
    expect(result.assistantMessage.parts[0]).toEqual({
      kind: "text",
      content: phase2,
    });
  });

  test("alias reuse works through orchestrator path", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const aliasReuseModel: ModelCallFn = async (
      _input: ModelCallInput,
    ): Promise<ModelCallResult> => ({
      parts: [{ kind: "text", content: "Synthesis complete." }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: aliasReuseModel,
      threadService: mockThreadService(),
    });

    const first = await orchestrator.sendMessage(parent.id, "Run task 1");
    const second = await orchestrator.sendMessage(parent.id, "Run task 2");

    expect(first.threadRuns).toHaveLength(1);
    expect(second.threadRuns).toHaveLength(1);
    expect(second.threadRuns[0]?.reused).toBe(true);
    expect(second.threadRuns[0]?.childSessionId).toBe(
      first.threadRuns[0]?.childSessionId,
    );
  });

  test("bounds delegations to preferred child threads", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const model: ModelCallFn = async (): Promise<ModelCallResult> => ({
      parts: [{ kind: "text", content: "Done." }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const calls: SpawnThreadInput[] = [];
    const fakeThreadService: ThreadService = {
      async spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult> {
        calls.push(input);
        const child = sessionStore.create({
          kind: "thread",
          parentId: parent.id,
          alias: input.alias,
        });

        const workerReturn = workerReturnStore.create({
          parentSessionId: parent.id,
          childSessionId: child.id,
          childType: "thread",
          alias: input.alias ?? null,
          task: input.task,
          status: "completed",
          output: "ok",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });

        const episode = createTestEpisode({
          parentSessionId: parent.id,
          childSessionId: child.id,
          workerReturnId: workerReturn.id,
          task: input.task,
          alias: input.alias,
          inputEpisodeIds: input.inputEpisodeIds,
        });

        return {
          childSession: child,
          reused: false,
          workerReturn,
          episode,
          inputEpisodeIds: input.inputEpisodeIds ?? [],
        };
      },
      listChildren(_parentSessionId: SessionId) {
        return [];
      },
      listWorkerReturns(_parentSessionId: SessionId) {
        return [];
      },
      getWorkerReturn(_id: string) {
        return null;
      },
      listEpisodes(_parentSessionId: SessionId) {
        return [];
      },
      getEpisode(_id: string) {
        return null;
      },
    };

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: model,
      threadService: fakeThreadService,
    });

    const result = await orchestrator.sendMessage(
      parent.id,
      "Inspect API and then update docs and also run tests",
    );

    expect(result.threadRuns).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.alias).toBeDefined();
    expect(calls[1]?.alias).toBeDefined();
  });
});
