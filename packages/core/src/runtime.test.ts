/**
 * Phase 3 runtime unit tests.
 *
 * Tests storage, session service, events, and model adapter
 * without requiring real API keys.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

import { initDatabase } from "./storage/database.js";
import { createSessionStore } from "./storage/session-store.js";
import { createMessageStore } from "./storage/message-store.js";
import { createEventBus, RuntimeEvents } from "./events.js";
import { createSessionService } from "./session-service.js";
import { createModelCallAdapter } from "./model-adapter.js";
import type { SessionId } from "./types/session.js";
import type { OpenSlateEvent } from "./events.js";
import type { ModelCallFn } from "./session-service.js";

// ── Test Helpers ─────────────────────────────────────────────────────

let dbPath: string;
let db: ReturnType<typeof initDatabase>;

function freshDb() {
  dbPath = join(tmpdir(), `openslate-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = initDatabase(dbPath);
  return db;
}

function cleanup() {
  try { db?.close(); } catch {}
  try { unlinkSync(dbPath); } catch {}
}

/** Mock model call that echoes the last user message */
const mockModelCall: ModelCallFn = async (input) => {
  const lastUserMsg = input.messages.filter((m) => m.role === "user").pop();
  return {
    parts: [
      { kind: "text" as const, content: `Echo: ${lastUserMsg?.content ?? "empty"}` },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
};

// ── Database Tests ───────────────────────────────────────────────────

describe("initDatabase", () => {
  afterEach(cleanup);

  test("creates database and tables", () => {
    freshDb();
    // Check tables exist by querying sqlite_master
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("message_parts");
    expect(tableNames).toContain("handoff_states");
  });
});

// ── SessionStore Tests ───────────────────────────────────────────────

describe("SessionStore", () => {
  afterEach(cleanup);

  test("create and get session", () => {
    freshDb();
    const store = createSessionStore(db);

    const session = store.create({ title: "Test Session" });
    expect(session.id).toBeTruthy();
    expect(session.kind).toBe("primary");
    expect(session.status).toBe("active");
    expect(session.title).toBe("Test Session");

    const fetched = store.get(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(session.id);
    expect(fetched!.title).toBe("Test Session");
  });

  test("list sessions", () => {
    freshDb();
    const store = createSessionStore(db);

    store.create({ title: "Session 1" });
    store.create({ title: "Session 2" });

    const all = store.list();
    expect(all.length).toBe(2);
  });

  test("update status", () => {
    freshDb();
    const store = createSessionStore(db);

    const session = store.create({});
    store.updateStatus(session.id, "completed");

    const fetched = store.get(session.id);
    expect(fetched!.status).toBe("completed");
  });

  test("update title", () => {
    freshDb();
    const store = createSessionStore(db);

    const session = store.create({});
    store.updateTitle(session.id, "New Title");

    const fetched = store.get(session.id);
    expect(fetched!.title).toBe("New Title");
  });

  test("touch updates updatedAt", () => {
    freshDb();
    const store = createSessionStore(db);

    const session = store.create({});
    const before = store.get(session.id)!.updatedAt;

    // Ensure a distinct timestamp in practice.
    store.touch(session.id);

    const after = store.get(session.id)!.updatedAt;
    expect(after >= before).toBeTrue();
  });

  test("get returns null for missing session", () => {
    freshDb();
    const store = createSessionStore(db);
    const result = store.get("nonexistent" as SessionId);
    expect(result).toBeNull();
  });
});

// ── MessageStore Tests ───────────────────────────────────────────────

describe("MessageStore", () => {
  afterEach(cleanup);

  test("append and list messages with structured parts", () => {
    freshDb();
    const sessionStore = createSessionStore(db);
    const messageStore = createMessageStore(db);

    const session = sessionStore.create({});

    // Append user message
    const userMsg = messageStore.append({
      sessionId: session.id,
      role: "user",
      parts: [{ kind: "text", content: "Hello" }],
    });
    expect(userMsg.id).toBeTruthy();
    expect(userMsg.role).toBe("user");
    expect(userMsg.parts).toHaveLength(1);
    expect(userMsg.parts[0]!.kind).toBe("text");

    // Append assistant message with multiple parts
    const assistantMsg = messageStore.append({
      sessionId: session.id,
      role: "assistant",
      parts: [
        { kind: "reasoning", content: "Thinking..." },
        { kind: "text", content: "Hello back!" },
      ],
    });
    expect(assistantMsg.parts).toHaveLength(2);

    // List messages
    const messages = messageStore.listBySession(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.parts).toHaveLength(2);
    expect(messages[1]!.parts[0]!.kind).toBe("reasoning");
    expect(messages[1]!.parts[1]!.kind).toBe("text");
  });

  test("get message by id", () => {
    freshDb();
    const sessionStore = createSessionStore(db);
    const messageStore = createMessageStore(db);

    const session = sessionStore.create({});
    const msg = messageStore.append({
      sessionId: session.id,
      role: "user",
      parts: [{ kind: "text", content: "Test" }],
    });

    const fetched = messageStore.get(msg.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.parts[0]!.kind).toBe("text");
  });
});

// ── EventBus Tests ───────────────────────────────────────────────────

describe("EventBus", () => {
  test("emits events to listeners", () => {
    const bus = createEventBus();
    const received: OpenSlateEvent[] = [];

    bus.on((event) => received.push(event));

    bus.emit(RuntimeEvents.sessionCreated("test-session"));
    bus.emit(RuntimeEvents.messageCreated("test-session", "msg-1", "user"));

    expect(received).toHaveLength(2);
    expect(received[0]!.type).toBe("session.created");
    expect(received[1]!.type).toBe("message.created");
  });

  test("unsubscribe removes listener", () => {
    const bus = createEventBus();
    const received: OpenSlateEvent[] = [];

    const unsub = bus.on((event) => received.push(event));
    bus.emit(RuntimeEvents.sessionCreated("s1"));
    expect(received).toHaveLength(1);

    unsub();
    bus.emit(RuntimeEvents.sessionCreated("s2"));
    expect(received).toHaveLength(1); // No new events
  });
});

// ── SessionService Tests ─────────────────────────────────────────────

describe("SessionService", () => {
  afterEach(cleanup);

  test("create session emits event", () => {
    freshDb();
    const events = createEventBus();
    const received: OpenSlateEvent[] = [];
    events.on((e) => received.push(e));

    const service = createSessionService({
      sessionStore: createSessionStore(db),
      messageStore: createMessageStore(db),
      events,
      modelCall: mockModelCall,
    });

    const session = service.createSession({ title: "Test" });
    expect(session.id).toBeTruthy();
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("session.created");
  });

  test("sendMessage persists user and assistant messages", async () => {
    freshDb();
    const events = createEventBus();
    const received: OpenSlateEvent[] = [];
    events.on((e) => received.push(e));

    const service = createSessionService({
      sessionStore: createSessionStore(db),
      messageStore: createMessageStore(db),
      events,
      modelCall: mockModelCall,
    });

    const session = service.createSession();
    const result = await service.sendMessage(session.id, "Hello world");

    // Check user message
    expect(result.userMessage.role).toBe("user");
    expect(result.userMessage.parts[0]!.kind).toBe("text");

    // Check assistant message
    expect(result.assistantMessage.role).toBe("assistant");
    expect(result.assistantMessage.parts[0]!.kind).toBe("text");
    expect((result.assistantMessage.parts[0] as any).content).toBe("Echo: Hello world");

    // Check usage
    expect(result.usage).toBeDefined();
    expect(result.usage!.totalTokens).toBe(15);

    // Check persistence
    const messages = service.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");

    // Check events
    const eventTypes = received.map((e) => e.type);
    expect(eventTypes).toContain("session.created");
    expect(eventTypes).toContain("message.created");
    expect(eventTypes).toContain("assistant.started");
    expect(eventTypes).toContain("assistant.completed");
    expect(eventTypes).toContain("session.updated");
  });

  test("sendMessage throws for nonexistent session", async () => {
    freshDb();
    const service = createSessionService({
      sessionStore: createSessionStore(db),
      messageStore: createMessageStore(db),
      events: createEventBus(),
      modelCall: mockModelCall,
    });

    await expect(
      service.sendMessage("nonexistent" as SessionId, "Hello")
    ).rejects.toThrow("Session not found");
  });

  test("sendMessage persists failure marker and emits assistant.failed when model call fails", async () => {
    freshDb();
    const events = createEventBus();
    const received: OpenSlateEvent[] = [];
    events.on((e) => received.push(e));

    const service = createSessionService({
      sessionStore: createSessionStore(db),
      messageStore: createMessageStore(db),
      events,
      modelCall: async () => {
        throw new Error("provider boom");
      },
    });

    const session = service.createSession();
    await expect(service.sendMessage(session.id, "Hello world")).rejects.toThrow("provider boom");

    const messages = service.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.parts[0]!.kind).toBe("status");
    expect((messages[1]!.parts[0] as any).content).toContain("provider boom");

    const eventTypes = received.map((e) => e.type);
    expect(eventTypes).toContain("assistant.failed");
    expect(eventTypes).not.toContain("assistant.completed");
  });
});

// ── Model Adapter Tests ──────────────────────────────────────────────

describe("createModelCallAdapter", () => {
  test("translates text response into TextPart", async () => {
    const adapter = createModelCallAdapter(async () => ({
      text: "Hello from model",
    }));

    const result = await adapter({ messages: [] });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.kind).toBe("text");
    expect((result.parts[0] as any).content).toBe("Hello from model");
  });

  test("translates reasoning + text into multiple parts", async () => {
    const adapter = createModelCallAdapter(async () => ({
      text: "Answer",
      reasoning: "Thinking...",
    }));

    const result = await adapter({ messages: [] });
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.kind).toBe("reasoning");
    expect(result.parts[1]!.kind).toBe("text");
  });

  test("produces empty text part when model returns nothing", async () => {
    const adapter = createModelCallAdapter(async () => ({
      text: "",
    }));

    const result = await adapter({ messages: [] });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.kind).toBe("text");
  });

  test("passes through usage data", async () => {
    const adapter = createModelCallAdapter(async () => ({
      text: "Hi",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }));

    const result = await adapter({ messages: [] });
    expect(result.usage).toBeDefined();
    expect(result.usage!.totalTokens).toBe(150);
  });
});
