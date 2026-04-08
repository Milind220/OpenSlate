#!/usr/bin/env bun
/**
 * OpenSlate TUI — main entry point.
 * Boots the server in-process and launches the terminal UI.
 */

import { bootstrap } from "@openslate/server";
import { createClient } from "@openslate/sdk";
import { App } from "./app.js";

async function main() {
  // ── Boot server ──────────────────────────────────────────────────
  const port = parseInt(process.env.OPENSLATE_PORT || "7632", 10);
  let server: Awaited<ReturnType<typeof bootstrap>> | null = null;

  try {
    server = await bootstrap({ port, host: "127.0.0.1" });
    await server.server.start();
    const url = "http://127.0.0.1:" + (server.server.port ?? port);

    // ── Create SDK client ────────────────────────────────────────────
    const client = createClient({ baseUrl: url });

    // ── Verify server is up ──────────────────────────────────────────
    try {
      await client.health();
    } catch (e) {
      console.error("Failed to connect to OpenSlate server:", e);
      process.exit(1);
    }

    // ── Launch TUI ───────────────────────────────────────────────────
    const app = new App(client);
    await app.run();
  } catch (e: any) {
    // Restore terminal before printing error
    process.stdout.write("\x1b[?25h"); // show cursor
    process.stdout.write("\x1b[r");    // reset scroll region
    process.stdout.write("\x1b[?1049l"); // restore main screen buffer
    if (e?.code === "EADDRINUSE") {
      console.error("\nPort " + port + " is already in use. Set OPENSLATE_PORT to use a different port.");
    } else {
      console.error("\nFatal error:", e?.message || e);
    }
    process.exit(1);
  } finally {
    // Graceful shutdown
    if (server?.server) {
      await server.server.stop();
    }
  }
}

main();
