/**
 * Home view — session picker.
 * Lists existing sessions, allows creating new ones.
 */

import type { OpenSlateClient } from "@openslate/sdk";
import type { Session, SessionId } from "@openslate/core";
import type { App } from "../app.js";
import { ansi, theme, getTerminalSize, writeln, write, horizontalRule, statusBadge, padRight, truncate } from "../renderer.js";

export class HomeView {
  private client: OpenSlateClient;
  private app: App;

  constructor(client: OpenSlateClient, app: App) {
    this.client = client;
    this.app = app;
  }

  async run(): Promise<void> {
    while (true) {
      write(ansi.clear);
      const { cols } = getTerminalSize();

      // ── Header ─────────────────────────────────────────────────────
      writeln(theme.accentBold + "  ◆ OpenSlate" + ansi.reset + theme.textDim + "  v0.0.1" + ansi.reset);
      writeln(horizontalRule(cols));
      writeln();

      // ── Session List ───────────────────────────────────────────────
      let sessions: Session[] = [];
      try {
        sessions = await this.client.listSessions();
        // Filter to primary sessions only, sort newest first
        sessions = sessions
          .filter((s) => s.kind === "primary")
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      } catch (e: any) {
        writeln(theme.error + "  Failed to load sessions: " + e.message + ansi.reset);
      }

      if (sessions.length === 0) {
        writeln(theme.textDim + "  No sessions yet. Create one to get started." + ansi.reset);
      } else {
        writeln(theme.text + "  Recent Sessions:" + ansi.reset);
        writeln();

        const maxShow = Math.min(sessions.length, 15);
        for (let i = 0; i < maxShow; i++) {
          const s = sessions[i]!;
          const num = theme.textDim + "  [" + (i + 1) + "]" + ansi.reset;
          const title = theme.text + " " + truncate(s.title || "Untitled", 40) + ansi.reset;
          const id = theme.sessionId + " " + s.id.slice(0, 8) + ansi.reset;
          const status = " " + statusBadge(s.status);
          const date = theme.textMuted + " " + formatRelativeTime(s.updatedAt) + ansi.reset;
          writeln(num + title + id + status + date);
        }
        if (sessions.length > maxShow) {
          writeln(theme.textDim + "  ... and " + (sessions.length - maxShow) + " more" + ansi.reset);
        }
      }
      writeln();
      writeln(horizontalRule(cols));
      writeln();
      writeln(theme.textDim + "  Commands:" + ansi.reset);
      writeln(theme.accent + "    n" + ansi.reset + theme.text + " — new session" + ansi.reset);
      if (sessions.length > 0) {
        writeln(theme.accent + "    1-" + Math.min(sessions.length, 15) + ansi.reset + theme.text + " — continue session" + ansi.reset);
      }
      writeln(theme.accent + "    q" + ansi.reset + theme.text + " — quit" + ansi.reset);
      writeln();

      // ── Input ──────────────────────────────────────────────────────
      const input = await this.app.prompt(theme.accent + "  > " + ansi.reset);

      if (input === "q" || input === "quit" || input === "exit") {
        this.app.quit();
        return;
      }

      if (input === "n" || input === "new") {
        try {
          const session = await this.client.createSession({ title: "New Session" });
          this.app.navigate({ type: "session", sessionId: session.id });
          return;
        } catch (e: any) {
          writeln(theme.error + "  Failed to create session: " + e.message + ansi.reset);
          await this.app.prompt(theme.textDim + "  Press Enter to continue..." + ansi.reset);
          continue;
        }
      }

      // Try to parse as session number
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= sessions.length) {
        const session = sessions[num - 1];
        if (!session) continue;
        this.app.navigate({ type: "session", sessionId: session.id });
        return;
      }
      // Invalid input, just redraw
    }
  }
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d ago";
  return new Date(iso).toLocaleDateString();
}
