/**
 * Session view — opencode-like transcript workspace.
 * Automatic orchestration is the primary message path.
 */

import type { OpenSlateClient, OrchestrateResponse } from "@openslate/sdk";
import type { Session, SessionId, Message, MessagePart, WorkerReturn, ThreadRunCard } from "@openslate/core";
import type { App } from "../app.js";
import { ansi, theme, getTerminalSize, writeln, write, horizontalRule, statusBadge, padRight, truncate, stripAnsi, box } from "../renderer.js";

type TranscriptEntry =
  | { type: "user"; message: Message }
  | { type: "assistant"; message: Message }
  | { type: "subagent-cards"; threadRuns: ThreadRunCard[] }
  | { type: "status"; text: string };

export class SessionView {
  private client: OpenSlateClient;
  private app: App;
  private sessionId: SessionId;

  private session: Session | null = null;
  private transcript: TranscriptEntry[] = [];
  private statusLine = "";
  private usage: OrchestrateResponse["usage"] = null;

  constructor(client: OpenSlateClient, app: App, sessionId: SessionId) {
    this.client = client;
    this.app = app;
    this.sessionId = sessionId;
  }

  async run(): Promise<void> {
    await this.loadInitialState();

    while (true) {
      this.render();
      const input = await this.app.prompt(theme.accent + "  > " + ansi.reset);
      if (!input) continue;

      if (input.startsWith("/")) {
        const shouldExit = await this.handleSlashCommand(input);
        if (shouldExit) return;
        continue;
      }

      await this.orchestrateMessage(input);
    }
  }

  private async loadInitialState(): Promise<void> {
    try {
      this.session = await this.client.getSession(this.sessionId);
      const messages = await this.client.getMessages(this.sessionId);

      this.transcript = [];
      for (const message of messages) {
        if (message.role === "user") {
          this.transcript.push({ type: "user", message });
        } else if (message.role === "assistant") {
          this.transcript.push({ type: "assistant", message });
        }
      }

      this.statusLine = theme.info + "Ready." + ansi.reset;
    } catch (e: any) {
      this.statusLine = theme.error + "Failed to load session: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async refreshSession(): Promise<void> {
    try {
      this.session = await this.client.getSession(this.sessionId);
    } catch {
      // Non-fatal; keep previous session snapshot.
    }
  }

  private render(): void {
    write(ansi.clear);
    const { cols, rows } = getTerminalSize();

    const sessionPrefix = this.sessionId.slice(0, 8);
    const status = this.session?.status || "active";
    const header =
      theme.accentBold + "◆ OpenSlate" + ansi.reset +
      theme.textDim + "  session " + ansi.reset +
      theme.sessionId + sessionPrefix + ansi.reset +
      theme.textDim + "  " + ansi.reset +
      statusBadge(status);

    writeln(" " + header);
    writeln(horizontalRule(cols));

    const transcriptLines = this.renderTranscriptLines(cols);
    const reserved = 5;
    const mainHeight = Math.max(6, rows - reserved);
    const visible = transcriptLines.slice(Math.max(0, transcriptLines.length - mainHeight));

    for (const line of visible) {
      writeln(line);
    }

    writeln(horizontalRule(cols));

    const usageLine = this.usage
      ? theme.textDim +
        "tokens " +
        theme.text + "p:" + this.usage.promptTokens + " " +
        theme.text + "c:" + this.usage.completionTokens + " " +
        theme.text + "t:" + this.usage.totalTokens +
        ansi.reset
      : theme.textDim + "tokens --" + ansi.reset;

    const left = " " + truncate(this.statusLine || (theme.textDim + "Idle" + ansi.reset), Math.max(10, Math.floor(cols * 0.6)));
    const right = usageLine;
    const gap = Math.max(1, cols - stripAnsi(left).length - stripAnsi(right).length);
    writeln(left + " ".repeat(gap) + right);
  }

  private renderTranscriptLines(cols: number): string[] {
    const lines: string[] = [];

    if (this.transcript.length === 0) {
      lines.push(" " + theme.textDim + "No messages yet. Start typing." + ansi.reset);
      return lines;
    }

    for (const entry of this.transcript) {
      if (entry.type === "user") {
        lines.push(...this.renderMessage(entry.message, "You", theme.role.user, cols));
        continue;
      }

      if (entry.type === "assistant") {
        lines.push(...this.renderMessage(entry.message, "OpenSlate", theme.role.assistant, cols));
        continue;
      }

      if (entry.type === "subagent-cards") {
        lines.push(...this.renderSubagentCards(entry.threadRuns, cols));
        lines.push("");
        continue;
      }

      lines.push(" " + theme.textDim + entry.text + ansi.reset);
      lines.push("");
    }

    return lines;
  }

  private renderMessage(message: Message, label: string, color: string, cols: number): string[] {
    const lines: string[] = [];
    const ts = new Date(message.createdAt).toLocaleTimeString();

    lines.push(" " + color + padRight(label, 9) + ansi.reset + " " + theme.textMuted + ts + ansi.reset);

    for (const part of message.parts) {
      lines.push(...this.renderMessagePart(part, cols));
    }

    lines.push("");
    return lines;
  }

  private renderMessagePart(part: MessagePart, cols: number): string[] {
    const out: string[] = [];
    const width = Math.max(20, cols - 2);

    if (part.kind === "text") {
      const rows = part.content.split("\n");
      for (const row of rows) out.push("  " + truncate(theme.text + row + ansi.reset, width));
      return out;
    }

    if (part.kind === "reasoning") {
      const rows = part.content.split("\n");
      for (const row of rows) out.push("  " + truncate(theme.textDim + "… " + row + ansi.reset, width));
      return out;
    }

    if (part.kind === "status") {
      out.push("  " + truncate(theme.info + part.content + ansi.reset, width));
      return out;
    }

    if (part.kind === "tool_call") {
      const args = this.safeJson(part.args);
      out.push("  " + truncate(theme.role.tool + "↳ " + part.toolName + ansi.reset + " " + theme.textDim + args + ansi.reset, width));
      return out;
    }

    if (part.kind === "tool_result") {
      const tone = part.isError ? theme.error : theme.info;
      const text = part.content ? part.content.replace(/\s+/g, " ").trim() : "(empty)";
      out.push("  " + truncate(tone + "↳ " + text + ansi.reset, width));
      return out;
    }

    if (part.kind === "worker_return_ref") {
      out.push("  " + truncate(theme.warning + "↳ worker return " + part.workerReturnId + ansi.reset, width));
      return out;
    }

    out.push("  " + truncate(theme.textDim + "[" + part.kind + "]" + ansi.reset, width));
    return out;
  }

  private renderSubagentCards(threadRuns: ThreadRunCard[], cols: number): string[] {
    const lines: string[] = [];
    const cardWidth = Math.max(52, Math.min(cols - 2, 112));
    const innerWidth = cardWidth - 2;

    const title = "─ Ran " + threadRuns.length + " subagents ";
    lines.push(" " + theme.border + "┌" + title + "─".repeat(Math.max(0, innerWidth - title.length)) + "┐" + ansi.reset);

    for (const run of threadRuns) {
      const alias = run.alias || "(unaliased)";
      const aliasStyled = theme.alias + alias + ansi.reset;
      const statusStyled = statusBadge(run.status);

      const leftPrefix = theme.textDim + "● " + ansi.reset + aliasStyled + "  ";
      const leftPrefixVisible = stripAnsi(leftPrefix).length;
      const rightVisible = stripAnsi(statusStyled).length;
      const taskBudget = Math.max(8, innerWidth - 2 - leftPrefixVisible - rightVisible - 2);
      const task = truncate(run.task, taskBudget);

      const left = leftPrefix + theme.text + task + ansi.reset;
      const gap = Math.max(1, innerWidth - 2 - stripAnsi(left).length - rightVisible);
      lines.push(" " + theme.border + "│ " + ansi.reset + left + " ".repeat(gap) + statusStyled + theme.border + " │" + ansi.reset);
    }

    lines.push(" " + theme.border + "└" + "─".repeat(innerWidth) + "┘" + ansi.reset);
    return lines;
  }

  private async orchestrateMessage(content: string): Promise<void> {
    this.statusLine = theme.textDim + "Orchestrating…" + ansi.reset;
    this.render();

    let stopProgress = false;
    const progressLoop = (async () => {
      while (!stopProgress) {
        try {
          const [children, returns] = await Promise.all([
            this.client.listChildren(this.sessionId),
            this.client.listWorkerReturns(this.sessionId),
          ]);

          const running = children.filter((c) => c.status === "active").length;
          const completed = returns.filter((r) => r.status === "completed").length;
          const failed = returns.filter((r) => r.status !== "completed").length;

          this.statusLine =
            theme.textDim + "Orchestrating… " + ansi.reset
            + theme.info + `children:${children.length} ` + ansi.reset
            + theme.success + `done:${completed} ` + ansi.reset
            + theme.warning + `running:${running} ` + ansi.reset
            + (failed > 0 ? theme.error + `issues:${failed}` + ansi.reset : "");
          this.render();
        } catch {
          // Best-effort progress updates.
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    })();

    try {
      const result = await this.client.orchestrate(this.sessionId, content);
      stopProgress = true;
      await progressLoop;

      this.transcript.push({ type: "user", message: result.userMessage });
      if (result.threadRuns.length > 0) {
        this.transcript.push({ type: "subagent-cards", threadRuns: result.threadRuns });
        await this.appendThreadWorkings(result.threadRuns);
      }
      this.transcript.push({ type: "assistant", message: result.assistantMessage });

      this.usage = result.usage;
      this.statusLine = theme.success + "Delivered." + ansi.reset;
      await this.refreshSession();
    } catch (e: any) {
      stopProgress = true;
      await progressLoop;
      this.statusLine = theme.error + "Orchestrate failed: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async appendThreadWorkings(threadRuns: ThreadRunCard[]): Promise<void> {
    for (const run of threadRuns) {
      try {
        const messages = await this.client.getMessages(run.childSessionId);
        const toolCalls = messages
          .flatMap((m) => m.parts)
          .filter((p): p is Extract<MessagePart, { kind: "tool_call" }> => p.kind === "tool_call");
        const toolResults = messages
          .flatMap((m) => m.parts)
          .filter((p): p is Extract<MessagePart, { kind: "tool_result" }> => p.kind === "tool_result");

        const lastCall = toolCalls.at(-1);
        const lastResult = toolResults.at(-1);
        const label = run.alias || run.childSessionId.slice(0, 8);
        const tail = lastResult
          ? truncate(lastResult.content.replace(/\s+/g, " "), 120)
          : "(no tool output)";

        this.transcript.push({
          type: "status",
          text:
            `subagent ${label}: calls ${toolCalls.length}, results ${toolResults.length}`
            + (lastCall ? `, last tool ${lastCall.toolName}` : "")
            + `, last result ${tail}`,
        });
      } catch {
        // Best-effort enrichment; keep flow resilient.
      }
    }
  }

  private async handleSlashCommand(input: string): Promise<boolean> {
    const raw = input.slice(1).trim();
    const [cmdRaw, ...rest] = raw.split(/\s+/);
    const command = (cmdRaw || "").toLowerCase();
    const argText = rest.join(" ").trim();

    if (!command) {
      this.statusLine = theme.warning + "Empty command. Use /help." + ansi.reset;
      return false;
    }

    if (command === "thread" || command === "t") {
      const parsed = this.parseAliasTask(argText);
      if (!parsed) {
        this.statusLine = theme.warning + "Usage: /thread <alias> <task>" + ansi.reset;
        return false;
      }

      try {
        const spawned = await this.client.spawnThread(this.sessionId, {
          alias: parsed.alias,
          task: parsed.task,
        });

        const card: ThreadRunCard = {
          alias: spawned.childSession.alias,
          task: spawned.workerReturn.task,
          childSessionId: spawned.childSession.id,
          status: spawned.workerReturn.status,
          reused: spawned.reused,
          output: spawned.workerReturn.output,
          workerReturnId: spawned.workerReturn.id,
          startedAt: spawned.workerReturn.startedAt,
          finishedAt: spawned.workerReturn.finishedAt,
        };

        this.transcript.push({ type: "subagent-cards", threadRuns: [card] });
        this.statusLine = theme.success + "Thread spawned." + ansi.reset;
        await this.refreshSession();
      } catch (e: any) {
        this.statusLine = theme.error + "Thread spawn failed: " + (e?.message || String(e)) + ansi.reset;
      }

      return false;
    }

    if (command === "inspect" || command === "i") {
      if (!argText) {
        this.statusLine = theme.warning + "Usage: /inspect <alias-or-id>" + ansi.reset;
        return false;
      }

      const local = this.findLocalThreadRun(argText);
      if (local) {
        await this.showPanel("inspect", this.inspectLinesFromThreadRun(local));
        this.statusLine = theme.info + "Inspection complete (local transcript)." + ansi.reset;
        return false;
      }

      try {
        const children = await this.client.listChildren(this.sessionId);
        const child = children.find((c) => c.alias === argText)
          || children.find((c) => c.id === argText)
          || children.find((c) => c.id.startsWith(argText));

        if (!child) {
          await this.showPanel("inspect", [theme.warning + "No child found for: " + argText + ansi.reset]);
          return false;
        }

        const returns = await this.client.listWorkerReturns(this.sessionId);
        const childMessages = await this.client.getMessages(child.id);
        const lines = this.buildChildInspectLines(child, returns, childMessages);

        await this.showPanel("inspect", lines);
        this.statusLine = theme.info + "Inspection complete." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Inspect failed: " + (e?.message || String(e)) + ansi.reset;
      }

      return false;
    }

    if (command === "returns" || command === "r") {
      try {
        const returns = await this.client.listWorkerReturns(this.sessionId);
        if (returns.length === 0) {
          await this.showPanel("worker returns", [theme.textDim + "No worker returns yet." + ansi.reset]);
        } else {
          const lines = returns
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            .map((ret) => {
              const alias = ret.alias ? theme.alias + ret.alias + ansi.reset : theme.textDim + "(no alias)" + ansi.reset;
              const task = truncate(ret.task, 56);
              return "- " + ret.id + "  " + statusBadge(ret.status) + "  " + alias + "  " + task;
            });
          await this.showPanel("worker returns", lines);
        }

        this.statusLine = theme.info + "Loaded worker returns." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to load worker returns: " + (e?.message || String(e)) + ansi.reset;
      }

      return false;
    }

    if (command === "children" || command === "c") {
      try {
        const children = await this.client.listChildren(this.sessionId);
        if (children.length === 0) {
          await this.showPanel("children", [theme.textDim + "No child sessions." + ansi.reset]);
        } else {
          const lines = children
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .map((child) => {
              const alias = child.alias ? theme.alias + child.alias + ansi.reset : theme.textDim + "(no alias)" + ansi.reset;
              return "- " + alias + "  " + theme.sessionId + child.id.slice(0, 12) + ansi.reset + "  " + statusBadge(child.status);
            });
          await this.showPanel("children", lines);
        }

        this.statusLine = theme.info + "Loaded children." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to list children: " + (e?.message || String(e)) + ansi.reset;
      }

      return false;
    }

    if (command === "sessions" || command === "s") {
      this.app.navigate({ type: "home" });
      return true;
    }

    if (command === "new") {
      try {
        const created = await this.client.createSession({ title: "New Session" });
        this.app.navigate({ type: "session", sessionId: created.id });
        return true;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to create session: " + (e?.message || String(e)) + ansi.reset;
        return false;
      }
    }

    if (command === "help" || command === "h") {
      await this.showPanel("commands", [
        theme.accent + "/thread <alias> <task>" + ansi.reset + " (or /t)",
        theme.accent + "/inspect <alias-or-id>" + ansi.reset + " (or /i)",
        theme.accent + "/children" + ansi.reset + " (or /c)",
        theme.accent + "/returns" + ansi.reset + " (or /r)",
        theme.accent + "/sessions" + ansi.reset + " (or /s)",
        theme.accent + "/new" + ansi.reset,
        theme.accent + "/help" + ansi.reset + " (or /h)",
        theme.accent + "/quit" + ansi.reset + " (or /q)",
      ]);
      this.statusLine = theme.info + "Displayed help." + ansi.reset;
      return false;
    }

    if (command === "quit" || command === "q") {
      this.app.quit();
      return true;
    }

    this.statusLine = theme.warning + "Unknown command: /" + command + " (try /help)" + ansi.reset;
    return false;
  }

  private findLocalThreadRun(selector: string): ThreadRunCard | null {
    for (let i = this.transcript.length - 1; i >= 0; i -= 1) {
      const entry = this.transcript[i];
      if (!entry || entry.type !== "subagent-cards") continue;

      const match = entry.threadRuns.find((run) =>
        run.alias === selector
        || run.childSessionId === selector
        || run.childSessionId.startsWith(selector)
        || run.workerReturnId === selector
      );

      if (match) return match;
    }

    return null;
  }

  private inspectLinesFromThreadRun(run: ThreadRunCard): string[] {
    return [
      theme.textDim + "child id: " + ansi.reset + theme.sessionId + run.childSessionId + ansi.reset,
      theme.textDim + "alias: " + ansi.reset + theme.alias + (run.alias || "(none)") + ansi.reset,
      theme.textDim + "task: " + ansi.reset + run.task,
      theme.textDim + "status: " + ansi.reset + statusBadge(run.status),
      theme.textDim + "worker return id: " + ansi.reset + run.workerReturnId,
      theme.textDim + "started: " + ansi.reset + run.startedAt,
      theme.textDim + "finished: " + ansi.reset + (run.finishedAt || "(running)"),
      "",
      theme.text + "output" + ansi.reset,
      theme.textDim + (run.output ? truncate(run.output, 1200) : "(none)") + ansi.reset,
    ];
  }

  private buildChildInspectLines(child: Session, returns: WorkerReturn[], childMessages: Message[]): string[] {
    const childReturns = returns
      .filter((r) => r.childSessionId === child.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const latest = childReturns[0];
    const toolCalls = childMessages
      .flatMap((m) => m.parts)
      .filter((p): p is Extract<MessagePart, { kind: "tool_call" }> => p.kind === "tool_call");
    const toolResults = childMessages
      .flatMap((m) => m.parts)
      .filter((p): p is Extract<MessagePart, { kind: "tool_result" }> => p.kind === "tool_result");

    const lines: string[] = [
      theme.textDim + "child id: " + ansi.reset + theme.sessionId + child.id + ansi.reset,
      theme.textDim + "alias: " + ansi.reset + theme.alias + (child.alias || "(none)") + ansi.reset,
      theme.textDim + "task: " + ansi.reset + (latest?.task || "(unknown)"),
      theme.textDim + "status: " + ansi.reset + statusBadge(latest?.status || child.status),
      theme.textDim + "child messages: " + ansi.reset + String(childMessages.length),
      theme.textDim + "tool calls: " + ansi.reset + String(toolCalls.length),
      theme.textDim + "tool results: " + ansi.reset + String(toolResults.length),
      "",
      theme.text + "worker returns" + ansi.reset,
    ];

    if (childReturns.length === 0) {
      lines.push(theme.textDim + "(none)" + ansi.reset);
    } else {
      for (const ret of childReturns.slice(0, 6)) {
        lines.push("- " + ret.id + "  " + statusBadge(ret.status) + "  " + truncate(ret.task, 72));
      }
    }

    lines.push("", theme.text + "tool calls" + ansi.reset);
    if (toolCalls.length === 0) {
      lines.push(theme.textDim + "(none)" + ansi.reset);
    } else {
      for (const call of toolCalls.slice(0, 8)) {
        lines.push("- " + call.toolName + " " + theme.textDim + this.safeJson(call.args) + ansi.reset);
      }
    }

    lines.push("", theme.text + "tool results" + ansi.reset);
    if (toolResults.length === 0) {
      lines.push(theme.textDim + "(none)" + ansi.reset);
    } else {
      for (const res of toolResults.slice(0, 8)) {
        const tone = res.isError ? theme.error : theme.info;
        lines.push("- " + tone + (res.isError ? "error" : "ok") + ansi.reset + " " + res.toolName + " " + truncate(res.content.replace(/\s+/g, " "), 84));
      }
    }

    lines.push("", theme.text + "recent child messages" + ansi.reset);
    const recent = childMessages.slice(Math.max(0, childMessages.length - 6));
    if (recent.length === 0) {
      lines.push(theme.textDim + "(none)" + ansi.reset);
    } else {
      for (const msg of recent) {
        const text = msg.parts
          .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
          .map((p) => p.content)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        lines.push("- [" + msg.role + "] " + truncate(text || "(non-text parts)", 96));
      }
    }

    return lines;
  }

  private parseAliasTask(argText: string): { alias: string; task: string } | null {
    const match = argText.match(/^(\S+)\s+([\s\S]+)$/);
    if (!match) return null;

    const alias = match[1]!.trim();
    let task = match[2]!.trim();

    if (
      (task.startsWith('"') && task.endsWith('"') && task.length >= 2)
      || (task.startsWith("'") && task.endsWith("'") && task.length >= 2)
    ) {
      task = task.slice(1, -1).trim();
    }

    if (!alias || !task) return null;
    return { alias, task };
  }

  private safeJson(value: unknown): string {
    try {
      return truncate(JSON.stringify(value), 80);
    } catch {
      return "{…}";
    }
  }

  private async showPanel(title: string, lines: string[]): Promise<void> {
    write(ansi.clear);
    const { cols } = getTerminalSize();
    const width = Math.max(54, Math.min(cols, 120));
    writeln(box(" " + title + " ", lines.join("\n"), width));
    writeln();
    await this.app.prompt(theme.textDim + "  Press Enter to continue..." + ansi.reset + " ");
  }
}
