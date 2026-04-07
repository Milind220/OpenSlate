#!/usr/bin/env bun
/**
 * Dev runner — starts the OpenSlate server for local development.
 *
 * Usage:
 *   bun run packages/server/src/dev.ts
 *
 * Requires ANTHROPIC_API_KEY or OPENAI_API_KEY in environment.
 */

import { bootstrap } from "./bootstrap.js";

async function main() {
  console.log("[openslate] bootstrapping runtime...");

  const { server, events } = await bootstrap();

  // Log all events to console during development
  events.on((event) => {
    console.log(`[event] ${event.type}`, JSON.stringify(event.payload));
  });

  await server.start();
  console.log("[openslate] runtime ready");
  console.log("[openslate] try: curl http://localhost:7274/health");
}

main().catch((err) => {
  console.error("[openslate] fatal:", err);
  process.exit(1);
});