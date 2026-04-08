import { describe, test, expect, beforeEach } from "bun:test";
import { initDatabase } from "./storage/database.js";
import { createSessionStore } from "./storage/session-store.js";
import { createMessageStore } from "./storage/message-store.js";
import { createWorkerReturnStore } from "./storage/worker-return-store.js";
import { createEventBus, RuntimeEvents } from "./events.js";
import { createOrchestratorService, parseDelegations } from "./orchestrator-service.js";
import { createThreadService } from "./thread-service.js";
import type { ModelCallFn, ModelCallInput, ModelCallResult } from "./session-service.js";
import type { ThreadService, SpawnThreadInput, SpawnThreadResult } from "./thread-service.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { WorkerReturnStore } from "./storage/worker-return-store.js";
import type { EventBus, OpenSlateEvent } from "./events.js";
import type { SessionId } from "./types/session.js";
import type { ChildToolCall } from "./child-runtime.js";

let db: ReturnType<typeof initDatabase>;
let sessionStore: SessionStore;
let messageStore: MessageStore;
let workerReturnStore: WorkerReturnStore;
let events: EventBus;
let emittedEvents: OpenSlateEvent[];

beforeEach(() => {
  db = initDatabase(":memory:");
  sessionStore = createSessionStore(db);
  messageStore = createMessageStore(db);
  workerReturnStore = createWorkerReturnStore(db);
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

function mockDelegatingModelCallFn(phase1Text: string, phase2Text: string): ModelCallFn {
  let callCount = 0;
  return async (_input: ModelCallInput): Promise<ModelCallResult> => {
    callCount++;
    if (callCount === 1) {
      return {
        parts: [{ kind: "text", content: phase1Text }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    }

    return {
      parts: [{ kind: "text", content: phase2Text }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  };
}

function mockThreadService(): ThreadService {
  return createThreadService({
    sessionStore,
    messageStore,
    workerReturnStore,
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

describe("parseDelegations", () => {
  test("correctly extracts delegate blocks from model output", () => {
    const text = [
      "Let me break this down.",
      "```delegate",
      '[{"alias":"code-reader","task":"Read the entry point"}]',
      "```",
      "I will report back.",
    ].join("\n");

    const parsed = parseDelegations(text);

    expect(parsed.delegations).toHaveLength(1);
    expect(parsed.delegations[0]?.alias).toBe("code-reader");
    expect(parsed.delegations[0]?.task).toBe("Read the entry point");
    expect(parsed.cleanText).not.toContain("```delegate");
  });

  test("returns empty for text with no delegate blocks", () => {
    const text = "Hello world";
    const parsed = parseDelegations(text);

    expect(parsed.delegations).toEqual([]);
    expect(parsed.cleanText).toBe(text);
  });

  test("handles malformed JSON gracefully", () => {
    const text = [
      "Before",
      "```delegate",
      "{not valid}",
      "```",
      "After",
    ].join("\n");

    const parsed = parseDelegations(text);

    expect(parsed.delegations).toEqual([]);
    expect(parsed.cleanText).not.toContain("```delegate");
    expect(parsed.cleanText).toContain("Before");
    expect(parsed.cleanText).toContain("After");
  });
});

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
    expect(result.assistantMessage.parts[0]).toEqual({ kind: "text", content: "Direct answer" });

    const persisted = messageStore.listBySession(parent.id);
    expect(persisted.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((persisted[0]?.parts[0] as { kind: string; content: string }).content).toBe("Hello");
  });

  test("sendMessage with delegation spawns threads and synthesizes", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const phase1 = 'Let me delegate.\n```delegate\n[{"alias":"reader","task":"read stuff"}]\n```';
    const phase2 = "Here is the synthesis based on thread results.";

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockDelegatingModelCallFn(phase1, phase2),
      threadService: mockThreadService(),
    });

    const result = await orchestrator.sendMessage(parent.id, "Do something complex");

    expect(result.threadRuns).toHaveLength(1);
    expect(result.threadRuns[0]?.status).toBe("completed");
    expect(result.threadRuns[0]?.alias).toBe("reader");
    expect(result.assistantMessage.parts[0]).toEqual({ kind: "text", content: phase2 });
  });

  test("strips delegate blocks from final synthesis response", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    const phase1 = 'Delegating\n```delegate\n[{"alias":"reader","task":"read stuff"}]\n```';
    const phase2 = [
      "Synthesizing from child output.",
      "```delegate",
      '[{"alias":"should-not-run","task":"ignore this"}]',
      "```",
    ].join("\n");

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockDelegatingModelCallFn(phase1, phase2),
      threadService: mockThreadService(),
    });

    const result = await orchestrator.sendMessage(parent.id, "Do something complex");

    expect(result.threadRuns).toHaveLength(1);
    const finalText = (result.assistantMessage.parts[0] as { kind: string; content: string }).content;
    expect(finalText).toContain("Synthesizing from child output.");
    expect(finalText).not.toContain("```delegate");
    expect(finalText).not.toContain("should-not-run");
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
    };

    const phase1 = 'Delegating\n```delegate\n[{"alias":"broken","task":"will fail"}]\n```';
    const phase2 = "Synthesis despite failure.";

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: mockDelegatingModelCallFn(phase1, phase2),
      threadService: failingThreadService,
    });

    const result = await orchestrator.sendMessage(parent.id, "Try anyway");

    expect(result.threadRuns).toHaveLength(1);
    expect(result.threadRuns[0]?.status).toBe("aborted");
    expect(result.threadRuns[0]?.output).toContain("Thread crashed");
    expect(result.assistantMessage.parts[0]).toEqual({ kind: "text", content: phase2 });
  });

  test("alias reuse works through orchestrator path", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    let callCount = 0;
    const aliasReuseModel: ModelCallFn = async (_input: ModelCallInput): Promise<ModelCallResult> => {
      callCount++;
      const isPhase1 = callCount % 2 === 1;
      return {
        parts: [{
          kind: "text",
          content: isPhase1
            ? 'Delegating\n```delegate\n[{"alias":"worker-a","task":"do work"}]\n```'
            : "Synthesis complete.",
        }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    };

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
    expect(second.threadRuns[0]?.childSessionId).toBe(first.threadRuns[0]?.childSessionId);
  });

  test("bounds delegations to two child threads", async () => {
    const parent = sessionStore.create({ kind: "primary" });

    let phase = 0;
    const model: ModelCallFn = async (): Promise<ModelCallResult> => {
      phase += 1;
      if (phase === 1) {
        return {
          parts: [{
            kind: "text",
            content: [
              "Delegating",
              "```delegate",
              '[{"alias":"one","task":"task one"},{"alias":"two","task":"task two"},{"alias":"three","task":"task three"}]',
              "```",
            ].join("\n"),
          }],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }

      return {
        parts: [{ kind: "text", content: "Done." }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    };

    const calls: SpawnThreadInput[] = [];
    const fakeThreadService: ThreadService = {
      async spawnAndRun(input: SpawnThreadInput): Promise<SpawnThreadResult> {
        calls.push(input);
        const child = sessionStore.create({ kind: "thread", parentId: parent.id, alias: input.alias });
        return {
          childSession: child,
          reused: false,
          workerReturn: workerReturnStore.create({
            parentSessionId: parent.id,
            childSessionId: child.id,
            childType: "thread",
            alias: input.alias ?? null,
            task: input.task,
            status: "completed",
            output: "ok",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          }),
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
    };

    const orchestrator = createOrchestratorService({
      sessionStore,
      messageStore,
      events,
      modelCall: model,
      threadService: fakeThreadService,
    });

    const result = await orchestrator.sendMessage(parent.id, "Do a broad scan");

    expect(result.threadRuns).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.alias).toBe("one");
    expect(calls[1]?.alias).toBe("two");
  });
});
