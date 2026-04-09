/**
 * Subagent detail view — full-screen transcript viewer for a child session.
 * Shows header, scrollable transcript, worker return summary, and footer key hints.
 * Uses raw key handling for scroll and navigation.
 */

import type { OpenSlateClient } from "@openslate/sdk";
import type {
  Session,
  SessionId,
  Message,
  MessagePart,
  WorkerReturn,
  Episode,
} from "@openslate/core";
import type { App } from "../app.js";
import {
  ansi,
  theme,
  getTerminalSize,
  write,
  writeln,
  horizontalRule,
  statusBadge,
  padRight,
  truncate,
  stripAnsi,
  keyHint,
} from "../renderer.js";

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

function safeJson(value: unknown): string {
  try {
    return truncate(JSON.stringify(value), 80);
  } catch {
    return "{…}";
  }
}

function formatTokenUsage(
  usage:
    | { promptTokens: number; completionTokens: number; totalTokens: number }
    | null
    | undefined,
): string {
  if (!usage) return "—";
  return (
    "p:" +
    usage.promptTokens +
    " c:" +
    usage.completionTokens +
    " t:" +
    usage.totalTokens
  );
}

// ── View ─────────────────────────────────────────────────────────────

export class SubagentDetailView {
  private client: OpenSlateClient;
  private app: App;
  private sessionId: SessionId;
  private childSessionId: SessionId;

  constructor(
    client: OpenSlateClient,
    app: App,
    sessionId: SessionId,
    childSessionId: SessionId,
  ) {
    this.client = client;
    this.app = app;
    this.sessionId = sessionId;
    this.childSessionId = childSessionId;
  }

  async run(): Promise<void> {
    // ── Load data ────────────────────────────────────────────────────
    let childSession: Session | null = null;
    let childMessages: Message[] = [];
    let workerReturn: WorkerReturn | null = null;
    let episode: Episode | null = null;
    let loadError: string | null = null;

    try {
      const [children, messages, returns, episodes] = await Promise.all([
        this.client.listChildren(this.sessionId),
        this.client.getChildMessages(this.sessionId, this.childSessionId),
        this.client.listWorkerReturns(this.sessionId),
        this.client.listEpisodes(this.sessionId),
      ]);

      childSession = children.find((c) => c.id === this.childSessionId) || null;
      childMessages = messages;

      // Find the most recent worker return for this child
      const childReturns = returns
        .filter((r) => r.childSessionId === this.childSessionId)
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
      workerReturn = childReturns[0] || null;

      if (workerReturn) {
        episode =
          episodes.find((item) => item.workerReturnId === workerReturn?.id) ??
          null;
      }
    } catch (e: any) {
      loadError = e?.message || String(e);
    }

    // ── Build renderable lines ───────────────────────────────────────
    const allLines = this.buildAllLines(
      childSession,
      childMessages,
      workerReturn,
      episode,
      loadError,
    );

    // ── Interactive scroll loop ──────────────────────────────────────
    let scrollOffset = 0;

    await new Promise<void>((resolve) => {
      const render = () => {
        const { rows, cols } = getTerminalSize();

        write(ansi.clear);

        // ── Header (2 lines + rule) ──────────────────────────────────
        const alias = childSession?.alias || "(unnamed)";
        const idPrefix = this.childSessionId.slice(0, 8);
        const status = workerReturn?.status || childSession?.status || "active";
        const task = workerReturn?.task || childSession?.title || "(no task)";
        const model = episode?.runtime.model || "—";
        const duration = formatDuration(episode?.runtime.durationMs);
        const headerLine1 =
          " " +
          theme.accentBold +
          "◆ Subagent" +
          ansi.reset +
          "  " +
          theme.alias +
          alias +
          ansi.reset +
          "  " +
          theme.sessionId +
          idPrefix +
          ansi.reset +
          "  " +
          statusBadge(status) +
          "  " +
          theme.textDim +
          "model:" +
          ansi.reset +
          " " +
          theme.text +
          model +
          ansi.reset +
          "  " +
          theme.textDim +
          duration +
          ansi.reset;

        const headerLine2 =
          " " +
          theme.textDim +
          "task:" +
          ansi.reset +
          " " +
          theme.text +
          truncate(task, Math.max(20, cols - 10)) +
          ansi.reset;

        writeln(headerLine1);
        writeln(headerLine2);
        writeln(horizontalRule(cols));

        // ── Footer (2 lines) ─────────────────────────────────────────
        const footerHeight = 2;
        const headerHeight = 3;
        const mainHeight = Math.max(4, rows - headerHeight - footerHeight);

        // ── Transcript area ──────────────────────────────────────────
        const maxScroll = Math.max(0, allLines.length - mainHeight);
        scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));

        const visible = allLines.slice(scrollOffset, scrollOffset + mainHeight);
        for (const line of visible) {
          writeln(truncate(line, cols));
        }
        // Fill remaining space
        const remaining = mainHeight - visible.length;
        for (let i = 0; i < remaining; i++) {
          writeln("");
        }

        // ── Footer ──────────────────────────────────────────────────
        writeln(horizontalRule(cols));
        const scrollInfo =
          theme.textDim +
          "line " +
          (scrollOffset + 1) +
          "–" +
          Math.min(scrollOffset + mainHeight, allLines.length) +
          " of " +
          allLines.length +
          ansi.reset;
        const hints =
          keyHint("Ctrl+B", "back") +
          "  " +
          keyHint("↑↓", "scroll") +
          "  " +
          keyHint("q", "quit");
        const gap = Math.max(
          1,
          cols -
            stripAnsi(" " + scrollInfo).length -
            stripAnsi(hints).length -
            2,
        );
        write(" " + scrollInfo + " ".repeat(gap) + hints);
      };

      render();

      const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (data: Buffer) => {
        const key = data.toString();

        // Ctrl+B — back to session
        if (key === "\x02") {
          cleanup();
          this.app.navigate({ type: "session", sessionId: this.sessionId });
          resolve();
          return;
        }

        // Escape — back to session
        if (key === "\x1b") {
          cleanup();
          this.app.navigate({ type: "session", sessionId: this.sessionId });
          resolve();
          return;
        }

        // q — quit app
        if (key === "q") {
          cleanup();
          this.app.quit();
          resolve();
          return;
        }

        // Arrow up
        if (key === "\x1b[A") {
          scrollOffset = Math.max(0, scrollOffset - 1);
          render();
          return;
        }

        // Arrow down
        if (key === "\x1b[B") {
          scrollOffset += 1;
          render();
          return;
        }

        // Page up
        if (key === "\x1b[5~") {
          const { rows } = getTerminalSize();
          const pageSize = Math.max(1, rows - 7);
          scrollOffset = Math.max(0, scrollOffset - pageSize);
          render();
          return;
        }

        // Page down
        if (key === "\x1b[6~") {
          const { rows } = getTerminalSize();
          const pageSize = Math.max(1, rows - 7);
          scrollOffset += pageSize;
          render();
          return;
        }
      };

      const cleanup = () => {
        process.stdin.removeListener("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(!!wasRaw);
      };

      process.stdin.on("data", onData);
    });
  }

  // ── Line Builders ──────────────────────────────────────────────────

  private buildAllLines(
    childSession: Session | null,
    messages: Message[],
    workerReturn: WorkerReturn | null,
    episode: Episode | null,
    loadError: string | null,
  ): string[] {
    const lines: string[] = [];

    if (loadError) {
      lines.push("");
      lines.push(
        " " +
          theme.error +
          "Failed to load subagent data: " +
          loadError +
          ansi.reset,
      );
      lines.push("");
      return lines;
    }

    // ── Transcript ───────────────────────────────────────────────────
    if (messages.length === 0) {
      lines.push("");
      lines.push(
        " " + theme.textDim + "No messages in this child session." + ansi.reset,
      );
    } else {
      for (const message of messages) {
        lines.push(...this.renderMessage(message));
      }
    }

    // ── Worker Return Summary ────────────────────────────────────────
    if (workerReturn) {
      lines.push("");
      lines.push(horizontalRule(76));
      lines.push("");
      lines.push(
        " " +
          theme.accentBold +
          "Worker Return" +
          ansi.reset +
          "  " +
          statusBadge(workerReturn.status) +
          "  " +
          theme.textDim +
          workerReturn.id.slice(0, 12) +
          ansi.reset,
      );
      lines.push("");

      const summary = episode?.summary ?? null;
      if (summary) {
        lines.push(" " + theme.text + "Summary:" + ansi.reset);
        const summaryLines = summary.split("\n");
        for (const sl of summaryLines) {
          lines.push("   " + theme.text + sl + ansi.reset);
        }
        lines.push("");
      }

      const keyFindings = episode?.keyFindings ?? [];
      if (keyFindings.length > 0) {
        lines.push(" " + theme.text + "Key Findings:" + ansi.reset);
        for (const finding of keyFindings) {
          lines.push(
            "   " +
              theme.info +
              "• " +
              ansi.reset +
              theme.text +
              finding +
              ansi.reset,
          );
        }
        lines.push("");
      }

      const filesRead = episode?.filesRead ?? [];
      const filesChanged = episode?.filesChanged ?? [];
      if (filesRead.length > 0 || filesChanged.length > 0) {
        lines.push(" " + theme.text + "Files:" + ansi.reset);
        for (const f of filesRead) {
          lines.push("   " + theme.textDim + "read  " + ansi.reset + f);
        }
        for (const f of filesChanged) {
          lines.push("   " + theme.warning + "write " + ansi.reset + f);
        }
        lines.push("");
      }

      const toolCallCount = episode?.runtime.toolCalls.length ?? 0;
      lines.push(
        " " +
          theme.textDim +
          "Tool calls: " +
          ansi.reset +
          theme.text +
          String(toolCallCount) +
          ansi.reset +
          "    " +
          theme.textDim +
          "Tokens: " +
          ansi.reset +
          theme.text +
          formatTokenUsage(episode?.runtime.tokenUsage) +
          ansi.reset,
      );
      lines.push(
        " " +
          theme.textDim +
          "Model: " +
          ansi.reset +
          (episode?.runtime.model
            ? theme.text + episode.runtime.model
            : theme.textDim + "—") +
          ansi.reset +
          "    " +
          theme.textDim +
          "Cost: " +
          ansi.reset +
          theme.text +
          (episode?.runtime.estimatedCostUsd != null
            ? "$" + episode.runtime.estimatedCostUsd.toFixed(4)
            : "—") +
          ansi.reset,
      );
      lines.push(
        " " +
          theme.textDim +
          "Completion contract: " +
          ansi.reset +
          theme.text +
          (episode?.completionContract.validity ?? "—") +
          ansi.reset,
      );
      lines.push("");
    }

    return lines;
  }

  private renderMessage(message: Message): string[] {
    const lines: string[] = [];
    const ts = new Date(message.createdAt).toLocaleTimeString();

    const roleLabels: Record<string, { label: string; color: string }> = {
      user: { label: "User", color: theme.role.user },
      assistant: { label: "Assistant", color: theme.role.assistant },
      system: { label: "System", color: theme.role.system },
      tool: { label: "Tool", color: theme.role.tool },
    };
    const { label, color } = roleLabels[message.role] || {
      label: message.role,
      color: theme.text,
    };

    lines.push("");
    lines.push(
      " " +
        color +
        padRight(label, 9) +
        ansi.reset +
        " " +
        theme.textMuted +
        ts +
        ansi.reset,
    );

    for (const part of message.parts) {
      lines.push(...this.renderMessagePart(part));
    }

    return lines;
  }

  private renderMessagePart(part: MessagePart): string[] {
    const out: string[] = [];

    if (part.kind === "text") {
      const rows = part.content.split("\n");
      for (const row of rows) {
        out.push("   " + theme.text + row + ansi.reset);
      }
      return out;
    }

    if (part.kind === "reasoning") {
      const rows = part.content.split("\n");
      for (const row of rows) {
        out.push("   " + theme.textDim + "… " + row + ansi.reset);
      }
      return out;
    }

    if (part.kind === "status") {
      out.push("   " + theme.info + part.content + ansi.reset);
      return out;
    }

    if (part.kind === "tool_call") {
      const args = safeJson(part.args);
      out.push(
        "   " +
          theme.role.tool +
          "↳ " +
          part.toolName +
          ansi.reset +
          " " +
          theme.textDim +
          args +
          ansi.reset,
      );
      return out;
    }

    if (part.kind === "tool_result") {
      const tone = part.isError ? theme.error : theme.info;
      const text = part.content
        ? part.content.replace(/\s+/g, " ").trim()
        : "(empty)";
      out.push(
        "   " +
          tone +
          "↳ " +
          part.toolName +
          ansi.reset +
          " " +
          theme.textDim +
          truncate(text, 120) +
          ansi.reset,
      );
      return out;
    }

    if (part.kind === "worker_return_ref") {
      out.push(
        "   " +
          theme.warning +
          "↳ worker return " +
          part.workerReturnId +
          ansi.reset,
      );
      return out;
    }

    if (part.kind === "handoff") {
      out.push(
        "   " +
          theme.info +
          "handoff: " +
          truncate(part.summary, 100) +
          ansi.reset,
      );
      return out;
    }

    out.push("   " + theme.textDim + "[" + part.kind + "]" + ansi.reset);
    return out;
  }
}
