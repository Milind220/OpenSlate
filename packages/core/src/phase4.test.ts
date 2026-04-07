/**
 * Phase 4 tests — thread runtime, child loop, worker returns, alias reuse.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { initDatabase } from "./storage/database.js";
import { createSessionStore } from "./storage/session-store.js";
import { createMessageStore } from "./storage/message-store.js";
import { createWorkerReturnStore } from "./storage/worker-return-store.js";
import { createEventBus, RuntimeEvents } from "./events.js";
import { createThreadService } from "./thread-service.js";
import { runChildLoop } from "./child-runtime.js";
import type { ChildModelCallFn, ChildToolCall, ChildToolResult, ToolExecutorFn } from "./child-runtime.js";
import type { SessionStore } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { WorkerReturnStore } from "./storage/worker-return-store.js";
import type { EventBus, OpenSlateEvent } from "./events.js";
import type { SessionId } from "./types/session.js";

// ── Test Helpers ─────────────────────────────────────────────────────

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

/** Mock model that returns text immediately (no tool calls). */
function mockSimpleModel(response: string): ChildModelCallFn {
  return async () => ({
    text: response,
    toolCalls: [],
    finishReason: "stop",
  });
}

/** Mock model that calls tools then returns text. */
function mockToolCallingModel(
  toolCalls: ChildToolCall[],
  finalResponse: string,
): ChildModelCallFn {
  let callCount = 0;
  return async () => {
    callCount++;
    if (callCount === 1) {
      return {
        text: "",
        toolCalls,
        finishReason: "tool-calls",
      };
    }
    return {
      text: finalResponse,
      toolCalls: [],
      finishReason: "stop",
    };
  };
}

/** Mock tool executor that returns fixed content. */
function mockToolExecutor(results: Record<string, string>): ToolExecutorFn {
  return async (call: ChildToolCall): Promise<ChildToolResult> => ({
    toolCallId: call.id,
    toolName: call.name,
    content: results[call.name] ?? "unknown tool",
    isError: false,
  });
}

// ── Storage Extension Tests ──────────────────────────────────────────

describe("SessionStore thread extensions", () => {
  test("create thread session with parent and alias", () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({
      kind: "thread",
      parentId: parent.id,
      alias: "doc-check",
      task: "Check the docs",
      capabilities: ["read", "search"],
    });

    expect(child.kind).toBe("thread");
    expect(child.parentId).toBe(parent.id);
    expect(child.alias).toBe("doc-check");
  });

  test("findByAlias returns matching child", () => {
    const parent = sessionStore.create({ kind: "primary" });
    sessionStore.create({
      kind: "thread",
      parentId: parent.id,
      alias: "doc-check",
    });

    const found = sessionStore.findByAlias(parent.id, "doc-check");
    expect(found).not.toBeNull();
    expect(found!.alias).toBe("doc-check");
    expect(found!.parentId).toBe(parent.id);
  });

  test("findByAlias returns null for non-existent alias", () => {
    const parent = sessionStore.create({ kind: "primary" });
    const found = sessionStore.findByAlias(parent.id, "nope");
    expect(found).toBeNull();
  });

  test("listChildren returns child sessions", () => {
    const parent = sessionStore.create({ kind: "primary" });
    sessionStore.create({ kind: "thread", parentId: parent.id, alias: "a" });
    sessionStore.create({ kind: "thread", parentId: parent.id, alias: "b" });

    const children = sessionStore.listChildren(parent.id);
    expect(children).toHaveLength(2);
  });

  test("getTask and getCapabilities work", () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({
      kind: "thread",
      parentId: parent.id,
      task: "Read the README",
      capabilities: ["read", "search"],
    });

    expect(sessionStore.getTask(child.id)).toBe("Read the README");
    expect(sessionStore.getCapabilities(child.id)).toEqual(["read", "search"]);
  });
});

describe("WorkerReturnStore", () => {
  test("create and get worker return", () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    const wr = workerReturnStore.create({
      parentSessionId: parent.id,
      childSessionId: child.id,
      childType: "thread",
      alias: "doc-check",
      task: "Check docs",
      status: "completed",
      output: "Docs look good",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    expect(wr.id).toBeDefined();
    expect(wr.status).toBe("completed");
    expect(wr.output).toBe("Docs look good");

    const fetched = workerReturnStore.get(wr.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.task).toBe("Check docs");
  });

  test("listByParent returns worker returns", () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    workerReturnStore.create({
      parentSessionId: parent.id,
      childSessionId: child.id,
      task: "Task 1",
      status: "completed",
      startedAt: new Date().toISOString(),
    });
    workerReturnStore.create({
      parentSessionId: parent.id,
      childSessionId: child.id,
      task: "Task 2",
      status: "completed",
      startedAt: new Date().toISOString(),
    });

    const returns = workerReturnStore.listByParent(parent.id);
    expect(returns).toHaveLength(2);
  });
});

// ── Child Runtime Loop Tests ─────────────────────────────────────────

describe("Child runtime loop", () => {
  test("simple completion without tools", async () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    const result = await runChildLoop(
      { childSessionId: child.id, task: "What is 2+2?" },
      {
        messageStore,
        events,
        modelCall: mockSimpleModel("The answer is 4."),
        executeTool: async () => ({ toolCallId: "", toolName: "", content: "", isError: false }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toBe("The answer is 4.");
    expect(result.iterations).toBe(1);

    // Verify messages were persisted
    const messages = messageStore.listBySession(child.id);
    expect(messages.length).toBeGreaterThanOrEqual(2); // user task + assistant response
  });

  test("tool-calling loop", async () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    const toolCalls: ChildToolCall[] = [
      { id: "tc-1", name: "read_file", args: { path: "/tmp/test.txt" } },
    ];

    const result = await runChildLoop(
      {
        childSessionId: child.id,
        task: "Read the test file",
        tools: {
          read_file: { description: "Read a file", parameters: { type: "object", properties: {} } },
        },
      },
      {
        messageStore,
        events,
        modelCall: mockToolCallingModel(toolCalls, "The file contains: hello world"),
        executeTool: mockToolExecutor({ read_file: "hello world" }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.output).toBe("The file contains: hello world");
    expect(result.iterations).toBe(2); // 1 tool call + 1 final response

    // Verify tool call and result were persisted
    const messages = messageStore.listBySession(child.id);
    const toolCallMsg = messages.find((m) => m.role === "assistant" && m.parts.some((p) => p.kind === "tool_call"));
    expect(toolCallMsg).toBeDefined();
    const toolResultMsg = messages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
  });

  test("max iterations abort", async () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    // Model always requests tool calls, never stops
    const infiniteToolModel: ChildModelCallFn = async () => ({
      text: "",
      toolCalls: [{ id: "tc-loop", name: "read_file", args: {} }],
      finishReason: "tool-calls",
    });

    const result = await runChildLoop(
      { childSessionId: child.id, task: "Loop forever", maxIterations: 3 },
      {
        messageStore,
        events,
        modelCall: infiniteToolModel,
        executeTool: mockToolExecutor({ read_file: "data" }),
      },
    );

    expect(result.status).toBe("aborted");
    expect(result.iterations).toBe(3);
  });

  test("model error produces failed status", async () => {
    const parent = sessionStore.create({ kind: "primary" });
    const child = sessionStore.create({ kind: "thread", parentId: parent.id });

    const failingModel: ChildModelCallFn = async () => {
      throw new Error("API rate limit");
    };

    const result = await runChildLoop(
      { childSessionId: child.id, task: "Fail" },
      {
        messageStore,
        events,
        modelCall: failingModel,
        executeTool: async () => ({ toolCallId: "", toolName: "", content: "", isError: false }),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.output).toContain("API rate limit");
  });
});

// ── Thread Service Tests ─────────────────────────────────────────────

describe("ThreadService", () => {
  function createTestThreadService() {
    return createThreadService({
      sessionStore,
      messageStore,
      workerReturnStore,
      events,
      childModelCall: mockSimpleModel("Task complete. Found 3 files."),
      createToolExecutor: () => async (call: ChildToolCall) => ({
        toolCallId: call.id,
        toolName: call.name,
        content: "mock result",
        isError: false,
      }),
      getToolSet: () => ({}),
    });
  }

  test("spawnAndRun creates child session and worker return", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    const result = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Check the docs",
      alias: "doc-check",
      capabilities: ["read", "search"],
    });

    expect(result.childSession.kind).toBe("thread");
    expect(result.childSession.parentId).toBe(parent.id);
    expect(result.childSession.alias).toBe("doc-check");
    expect(result.reused).toBe(false);

    expect(result.workerReturn.status).toBe("completed");
    expect(result.workerReturn.output).toBe("Task complete. Found 3 files.");
    expect(result.workerReturn.alias).toBe("doc-check");
    expect(result.workerReturn.parentSessionId).toBe(parent.id);
    expect(result.workerReturn.childSessionId).toBe(result.childSession.id);
  });

  test("alias reuse returns same child session", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    const first = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "First task",
      alias: "worker-a",
    });

    const second = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Second task",
      alias: "worker-a",
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.childSession.id).toBe(first.childSession.id);

    // Both should have worker returns
    const returns = threadService.listWorkerReturns(parent.id);
    expect(returns).toHaveLength(2);
  });

  test("different aliases create different children", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    const a = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Task A",
      alias: "worker-a",
    });

    const b = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Task B",
      alias: "worker-b",
    });

    expect(a.childSession.id).not.toBe(b.childSession.id);

    const children = threadService.listChildren(parent.id);
    expect(children).toHaveLength(2);
  });

  test("thread lifecycle events are emitted", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Check docs",
      alias: "doc-check",
    });

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("thread.created");
    expect(eventTypes).toContain("thread.started");
    expect(eventTypes).toContain("thread.completed");
    expect(eventTypes).toContain("worker_return.created");
  });

  test("alias reuse emits thread.reused event", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "First",
      alias: "reuse-me",
    });

    emittedEvents = [];

    await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Second",
      alias: "reuse-me",
    });

    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("thread.reused");
    expect(eventTypes).not.toContain("thread.created");
  });

  test("spawnAndRun without alias creates unique sessions", async () => {
    const threadService = createTestThreadService();
    const parent = sessionStore.create({ kind: "primary" });

    const a = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Task A",
    });

    const b = await threadService.spawnAndRun({
      parentSessionId: parent.id,
      task: "Task B",
    });

    expect(a.childSession.id).not.toBe(b.childSession.id);
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(false);
  });

  test("spawnAndRun throws for missing parent", async () => {
    const threadService = createTestThreadService();

    await expect(
      threadService.spawnAndRun({
        parentSessionId: "nonexistent" as SessionId,
        task: "Should fail",
      }),
    ).rejects.toThrow("Parent session not found");
  });
});

// ── Event System Tests ───────────────────────────────────────────────

describe("Thread events", () => {
  test("RuntimeEvents.threadCreated produces correct shape", () => {
    const event = RuntimeEvents.threadCreated("parent-1", "child-1", "my-alias", "do stuff");
    expect(event.type).toBe("thread.created");
    expect(event.payload.parentSessionId).toBe("parent-1");
    expect(event.payload.childSessionId).toBe("child-1");
    expect(event.payload.alias).toBe("my-alias");
    expect(event.payload.task).toBe("do stuff");
    expect(event.timestamp).toBeDefined();
  });

  test("RuntimeEvents.workerReturnCreated produces correct shape", () => {
    const event = RuntimeEvents.workerReturnCreated("wr-1", "parent-1", "child-1", "completed");
    expect(event.type).toBe("worker_return.created");
    expect(event.payload.workerReturnId).toBe("wr-1");
    expect(event.payload.status).toBe("completed");
  });
});

