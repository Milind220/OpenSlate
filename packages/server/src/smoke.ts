#!/usr/bin/env bun
/**
 * Smoke test — proves the Phase 3 runtime end-to-end.
 *
 * Usage:
 *   bun run packages/server/src/smoke.ts
 *
 * Requires ANTHROPIC_API_KEY, OPENAI_API_KEY, or FIREWORKS_API_KEY in environment.
 * For provider/model overrides, set:
 *   OPENSLATE_PRIMARY_PROVIDER=<provider>
 *   OPENSLATE_PRIMARY_MODEL=<model>
 *
 * This script:
 * 1. Bootstraps the runtime with an in-memory database
 * 2. Starts the server
 * 3. Creates a session via HTTP
 * 4. Sends a message via HTTP
 * 5. Retrieves messages via HTTP
 * 6. Verifies everything works
 * 7. Shuts down
 */

import { bootstrap } from "./bootstrap.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const dbPath = join(tmpdir(), `openslate-smoke-${Date.now()}.db`);
  console.log("\n=== OpenSlate Phase 3 Smoke Test ===\n");
  console.log(`Database: ${dbPath}`);

  // Track events
  const events: Array<{ type: string; payload: unknown }> = [];

  // 1. Bootstrap
  console.log("\n[1] Bootstrapping runtime...");
  const runtime = await bootstrap({
    port: 0, // Let Bun pick a port
    dbPath,
    systemPrompt: "You are OpenSlate, a helpful AI assistant. Keep responses concise.",
  });

  runtime.events.on((event) => {
    events.push({ type: event.type, payload: event.payload });
    console.log(`  [event] ${event.type}`);
  });

  // 2. Start server
  console.log("\n[2] Starting server...");
  await runtime.server.start();

  // Get the actual port from the config (Bun may assign one)
  const port = runtime.server.port ?? runtime.server.config.port;
  const base = `http://localhost:${port}`;
  console.log(`  Server at: ${base}`);

  try {
    // 3. Health check
    console.log("\n[3] Health check...");
    const health = await fetch(`${base}/health`).then((r) => r.json());
    console.log(`  Health: ${JSON.stringify(health)}`);
    assert(health.ok === true, "Health check failed");

    // 4. Create session
    console.log("\n[4] Creating session...");
    const session = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Smoke Test Session" }),
    }).then((r) => r.json());
    console.log(`  Session ID: ${session.id}`);
    console.log(`  Kind: ${session.kind}`);
    assert(session.id, "Session has no ID");
    assert(session.kind === "primary", "Session kind should be primary");

    // 5. Get session
    console.log("\n[5] Fetching session...");
    const fetchedSession = await fetch(`${base}/sessions/${session.id}`).then((r) => r.json());
    assert(fetchedSession.id === session.id, "Fetched session ID mismatch");
    console.log(`  Title: ${fetchedSession.title}`);

    // 6. Send message
    console.log("\n[6] Sending message...");
    console.log('  Prompt: "What is 2 + 2? Answer in one word."');
    const messageResponse = await fetch(`${base}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "What is 2 + 2? Answer in one word." }),
    });

    const result = await messageResponse.json();
    if (!messageResponse.ok) {
      throw new Error(
        `Message request failed with HTTP ${messageResponse.status}: ${JSON.stringify(result)}`
      );
    }

    console.log(`  User message ID: ${result.userMessage.id}`);
    console.log(`  Assistant message ID: ${result.assistantMessage.id}`);
    console.log(`  Assistant parts: ${result.assistantMessage.parts.length}`);
    for (const part of result.assistantMessage.parts) {
      console.log(`    [${part.kind}] ${previewPart(part)}`);
    }
    if (result.usage) {
      console.log(`  Usage: ${result.usage.promptTokens}p / ${result.usage.completionTokens}c / ${result.usage.totalTokens}t`);
    }

    assert(result.userMessage.id, "User message has no ID");
    assert(result.assistantMessage.id, "Assistant message has no ID");
    assert(result.assistantMessage.parts.length > 0, "Assistant has no message parts");
    assert(
      result.assistantMessage.parts.some((p: any) => p.kind === "text"),
      "Assistant has no text part"
    );

    // 7. Get messages
    console.log("\n[7] Fetching messages...");
    const messages = await fetch(`${base}/sessions/${session.id}/messages`).then((r) => r.json());
    console.log(`  Total messages: ${messages.length}`);
    assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);
    assert(messages[0].role === "user", "First message should be user");
    assert(messages[1].role === "assistant", "Second message should be assistant");

    // Verify structured parts
    const assistantMsg = messages[1];
    assert(assistantMsg.parts.length > 0, "Persisted assistant message has no parts");
    console.log(`  Assistant parts from DB: ${assistantMsg.parts.map((p: any) => p.kind).join(", ")}`);

    // 8. Verify events
    console.log("\n[8] Verifying events...");
    const eventTypes = events.map((e) => e.type);
    console.log(`  Events fired: ${eventTypes.join(", ")}`);
    assert(eventTypes.includes("session.created"), "Missing session.created event");
    assert(eventTypes.includes("message.created"), "Missing message.created event");
    assert(eventTypes.includes("assistant.started"), "Missing assistant.started event");
    assert(eventTypes.includes("assistant.completed"), "Missing assistant.completed event");
    assert(eventTypes.includes("session.updated"), "Missing session.updated event");

    console.log("\n=== ALL CHECKS PASSED ===\n");
  } catch (err) {
    console.error("\n=== SMOKE TEST FAILED ===");
    console.error(err);
    process.exit(1);
  } finally {
    await runtime.server.stop();
    runtime.db.close();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function previewPart(part: any): string {
  const value = part?.content ?? part?.summary ?? part?.ref ?? part?.toolName ?? "";
  if (typeof value === "string") return value.substring(0, 200);
  try {
    return JSON.stringify(value).substring(0, 200);
  } catch {
    return String(value).substring(0, 200);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

if (process.env.OPENSLATE_PRIMARY_PROVIDER || process.env.OPENSLATE_PRIMARY_MODEL) {
  console.log(
    `Model override: ${process.env.OPENSLATE_PRIMARY_PROVIDER ?? "<unset>"} / ${process.env.OPENSLATE_PRIMARY_MODEL ?? "<unset>"}`
  );
}
