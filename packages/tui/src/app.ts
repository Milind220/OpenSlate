/**
 * OpenSlate TUI — main application controller.
 * Routes between Home (session picker) and Session (workspace) views.
 */

import * as readline from "readline";
import type { OpenSlateClient } from "@openslate/sdk";
import type { Session, SessionId } from "@openslate/core";
import {
  ansi,
  theme,
  getTerminalSize,
  writeln,
  write,
  horizontalRule,
  statusBadge,
} from "./renderer.js";
import { HomeView } from "./views/home.js";
import { SessionView } from "./views/session.js";
import { SubagentDetailView } from "./views/subagent-detail.js";

export type Route =
  | { type: "home" }
  | { type: "session"; sessionId: SessionId }
  | { type: "subagent"; sessionId: SessionId; childSessionId: SessionId };
export class App {
  private client: OpenSlateClient;
  private route: Route = { type: "home" };
  private rl: readline.Interface | null = null;
  private running = false;

  constructor(client: OpenSlateClient) {
    this.client = client;
  }

  async run(): Promise<void> {
    this.running = true;
    this.setupTerminal();

    try {
      while (this.running) {
        if (this.route.type === "home") {
          await this.runHome();
        } else if (this.route.type === "session") {
          await this.runSession(this.route.sessionId);
        } else {
          await this.runSubagent(
            this.route.sessionId,
            this.route.childSessionId,
          );
        }
      }
    } finally {
      this.restoreTerminal();
    }
  }

  private setupTerminal(): void {
    // Enable alternative screen buffer for clean exit
    write("\x1b[?1049h");
    write(ansi.clear);
    write(ansi.hideCursor);
  }

  private restoreTerminal(): void {
    write(ansi.showCursor);
    write(ansi.resetScroll);
    // Restore main screen buffer
    write("\x1b[?1049l");
  }

  navigate(route: Route): void {
    this.route = route;
  }

  quit(): void {
    this.running = false;
  }

  // ── Home View ────────────────────────────────────────────────────

  private async runHome(): Promise<void> {
    const home = new HomeView(this.client, this);
    await home.run();
  }

  // ── Session View ─────────────────────────────────────────────────

  private async runSession(sessionId: SessionId): Promise<void> {
    const view = new SessionView(this.client, this, sessionId);
    await view.run();
  }

  private async runSubagent(
    sessionId: SessionId,
    childSessionId: SessionId,
  ): Promise<void> {
    const view = new SubagentDetailView(
      this.client,
      this,
      sessionId,
      childSessionId,
    );
    await view.run();
  }

  // ── Prompt Helper ────────────────────────────────────────────────
  async prompt(promptText: string): Promise<string> {
    write(ansi.showCursor);
    return new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      rl.question(promptText, (answer) => {
        rl.close();
        write(ansi.hideCursor);
        resolve(answer.trim());
      });
    });
  }
}
