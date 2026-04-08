/**
 * Session view — main workspace.
 * Renders transcript, accepts user input, and supports thread/inspection slash commands.
 */

import type { OpenSlateClient } from "@openslate/sdk";
import type { Session, SessionId, Message, WorkerReturn } from "@openslate/core";
import type { App } from "../app.js";
import { ansi, theme, getTerminalSize, writeln, write, horizontalRule, statusBadge, padRight, truncate, stripAnsi, box } from "../renderer.js";

export class SessionView {
  private client: OpenSlateClient;
  private app: App;
  private sessionId: SessionId;

  private session: Session | null = null;
  private messages: Message[] = [];
  private statusLine = "";

  constructor(client: OpenSlateClient, app: App, sessionId: SessionId) {
    this.client = client;
    this.app = app;
    this.sessionId = sessionId;
  }

  async run(): Promise<void> {
    await this.loadState();

    while (true) {
      this.render();
      const input = await this.app.prompt(theme.accent + "  > " + ansi.reset);

      if (!input) {
        continue;
      }

      if (input.startsWith("/")) {
        const shouldExit = await this.handleSlashCommand(input);
        if (shouldExit) {
          return;
        }
        await this.loadState();
        continue;
      }

      await this.sendMessage(input);
      await this.loadState();
    }
  }

  private async loadState(): Promise<void> {
    try {
      this.session = await this.client.getSession(this.sessionId);
      this.messages = await this.client.getMessages(this.sessionId);
    } catch (e: any) {
      this.statusLine = theme.error + "Failed to load session state: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private render(): void {
    write(ansi.clear);
    const { cols, rows } = getTerminalSize();
    const width = Math.max(50, Math.min(cols, 120));

    writeln(theme.accentBold + "  ◆ OpenSlate Workspace" + ansi.reset);
    writeln(horizontalRule(cols));
    writeln();

    const session = this.session;
    if (!session) {
      writeln(theme.error + "  Session not loaded." + ansi.reset);
      writeln();
      return;
    }

    const headerLines = [
      theme.textDim + "ID: " + ansi.reset + theme.sessionId + session.id + ansi.reset,
      theme.textDim + "Title: " + ansi.reset + theme.text + (session.title || "Untitled") + ansi.reset,
      theme.textDim + "Status: " + ansi.reset + statusBadge(session.status),
    ];

    writeln(box(" session ", headerLines.join("\n"), width));
    writeln();

    writeln(theme.text + "  Transcript" + ansi.reset);
    writeln(horizontalRule(cols));

    const transcriptLines: string[] = [];
    if (this.messages.length === 0) {
      transcriptLines.push(theme.textDim + "  No messages yet. Type to begin." + ansi.reset);
    } else {
      for (const message of this.messages) {
        transcriptLines.push(...this.formatMessage(message, cols));
      }
    }

    const reserved = 8;
    const maxTranscript = Math.max(6, rows - reserved);
    const visibleTranscript = transcriptLines.slice(Math.max(0, transcriptLines.length - maxTranscript));
    for (const line of visibleTranscript) {
      writeln(line);
    }

    writeln(horizontalRule(cols));
    const hintLeft = theme.textDim + "  /h for help" + ansi.reset;
    const hintRight = theme.textMuted + "Session " + this.sessionId.slice(0, 8) + ansi.reset;
    const gap = Math.max(1, cols - stripAnsi(hintLeft).length - stripAnsi(hintRight).length);
    writeln(hintLeft + " ".repeat(gap) + hintRight);

    if (this.statusLine) {
      writeln("  " + truncate(this.statusLine, Math.max(10, cols - 4)));
    }
  }

  private formatMessage(message: Message, cols: number): string[] {
    const lines: string[] = [];
    const roleStyle = this.roleStyle(message.role);
    const roleLabel = "[" + message.role + "]";
    const time = new Date(message.createdAt).toLocaleTimeString();

    const prefix = "  " + roleStyle + padRight(roleLabel, 11) + ansi.reset;
    lines.push(prefix + " " + theme.textMuted + time + ansi.reset);

    for (const part of message.parts) {
      if (part.kind === "text") {
        const content = part.content;
        const textLines = content.split("\n");
        for (const line of textLines) {
          lines.push(this.clipLine("     " + theme.text + line + ansi.reset, cols));
        }
        continue;
      }
      if (part.kind === "reasoning") {
        const content = String(part.content ?? "");
        const textLines = content.split("\n");
        for (const line of textLines) {
          lines.push(this.clipLine("     " + theme.textDim + "… " + line + ansi.reset, cols));
        }
        continue;
      }

      if (part.kind === "tool_call") {
        const toolName = String(part.toolName ?? "unknown_tool");
        const argsSummary = this.summarizeArgs(part.args as Record<string, unknown> | undefined);
        lines.push(this.clipLine("     " + theme.role.tool + "↳ tool_call" + ansi.reset + " " + theme.accent + toolName + ansi.reset + " " + theme.textDim + argsSummary + ansi.reset, cols));
        continue;
      }

      if (part.kind === "tool_result") {
        const isError = Boolean(part.isError);
        const content = String(part.content ?? "").replace(/\s+/g, " ").trim();
        const truncated = truncate(content || "(empty)", 80);
        const color = isError ? theme.error : theme.info;
        lines.push(this.clipLine("     " + theme.role.tool + "↳ tool_result" + ansi.reset + " " + color + truncated + ansi.reset, cols));
        continue;
      }

      if (part.kind === "worker_return_ref") {
        const ref = String(part.workerReturnId ?? "");
        lines.push(this.clipLine("     " + theme.warning + "↳ worker_return_ref " + ref + ansi.reset, cols));
        continue;
      }

      lines.push(this.clipLine("     " + theme.textDim + "↳ [" + part.kind + "]" + ansi.reset, cols));
    }

    lines.push("");
    return lines;
  }

  private clipLine(line: string, cols: number): string {
    return truncate(line, Math.max(10, cols - 1));
  }

  private roleStyle(role: string): string {
    if (role === "user") return theme.role.user;
    if (role === "assistant") return theme.role.assistant;
    if (role === "tool") return theme.role.tool;
    if (role === "system") return theme.role.system;
    return theme.textDim;
  }

  private summarizeArgs(args: Record<string, unknown> | undefined): string {
    if (!args) return "{}";
    try {
      return truncate(JSON.stringify(args), 64);
    } catch {
      return "{…}";
    }
  }

  private async sendMessage(content: string): Promise<void> {
    try {
      const result = await this.client.sendMessage(this.sessionId, content);
      this.messages.push(result.userMessage, result.assistantMessage);

      if (result.usage) {
        this.statusLine =
          theme.info +
          "Tokens — prompt: " + result.usage.promptTokens +
          ", completion: " + result.usage.completionTokens +
          ", total: " + result.usage.totalTokens +
          ansi.reset;
      } else {
        this.statusLine = theme.info + "Message sent." + ansi.reset;
      }
    } catch (e: any) {
      this.statusLine = theme.error + "Send failed: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async handleSlashCommand(input: string): Promise<boolean> {
    const raw = input.slice(1).trim();
    if (!raw) {
      this.statusLine = theme.warning + "Empty command. Use /help." + ansi.reset;
      return false;
    }

    const space = raw.indexOf(" ");
    const command = (space === -1 ? raw : raw.slice(0, space)).toLowerCase();
    const argText = (space === -1 ? "" : raw.slice(space + 1)).trim();

    if (command === "thread" || command === "t") {
      const parsed = this.parseAliasTask(argText);
      if (!parsed) {
        this.statusLine = theme.warning + "Usage: /thread <alias> <task>" + ansi.reset;
        return false;
      }

      try {
        const result = await this.client.spawnThread(this.sessionId, {
          alias: parsed.alias,
          task: parsed.task,
        });

        await this.showPanel("thread spawned", [
          theme.textDim + "alias: " + ansi.reset + theme.alias + (result.childSession.alias || "(none)") + ansi.reset,
          theme.textDim + "child id: " + ansi.reset + theme.sessionId + result.childSession.id + ansi.reset,
          theme.textDim + "status: " + ansi.reset + statusBadge(result.childSession.status),
          theme.textDim + "worker return: " + ansi.reset + result.workerReturn.id,
          theme.textDim + "reused: " + ansi.reset + (result.reused ? "yes" : "no"),
        ]);

        this.statusLine = theme.success + "Thread request completed." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to spawn thread: " + (e?.message || String(e)) + ansi.reset;
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
            .sort((a: Session, b: Session) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .map((child: Session) => {
              const alias = child.alias ? theme.alias + child.alias + ansi.reset : theme.textDim + "(no alias)" + ansi.reset;
              return "- " + alias + "  " + theme.sessionId + child.id.slice(0, 12) + ansi.reset + "  " + statusBadge(child.status);
            });
          await this.showPanel("children", lines);
        }
        this.statusLine = theme.info + "Loaded child sessions." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to list children: " + (e?.message || String(e)) + ansi.reset;
      }
      return false;
    }

    if (command === "inspect") {
      if (!argText) {
        this.statusLine = theme.warning + "Usage: /inspect <alias-or-id>" + ansi.reset;
        return false;
      }

      try {
        const children = await this.client.listChildren(this.sessionId);
        const returns = await this.client.listWorkerReturns(this.sessionId);

        const child = children.find((c: Session) => c.alias === argText)
          || children.find((c: Session) => c.id === argText)
          || children.find((c: Session) => c.id.startsWith(argText));

        if (!child) {
          await this.showPanel("inspect", [theme.warning + "No child found for: " + argText + ansi.reset]);
          return false;
        }

        const childReturns = returns.filter((r: WorkerReturn) => r.childSessionId === child.id);
        const lines = [
          theme.textDim + "id: " + ansi.reset + theme.sessionId + child.id + ansi.reset,
          theme.textDim + "alias: " + ansi.reset + (child.alias ? theme.alias + child.alias + ansi.reset : "(none)"),
          theme.textDim + "title: " + ansi.reset + child.title,
          theme.textDim + "status: " + ansi.reset + statusBadge(child.status),
          "",
          theme.text + "worker returns:" + ansi.reset,
        ];

        if (childReturns.length === 0) {
          lines.push(theme.textDim + "  none" + ansi.reset);
        } else {
          for (const ret of childReturns) {
            lines.push("  - " + ret.id + "  " + statusBadge(ret.status) + "  " + truncate(ret.task, 50));
          }
        }

        await this.showPanel("inspect child", lines);
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
          await this.showPanel("worker returns", [theme.textDim + "No worker returns." + ansi.reset]);
        } else {
          const lines = returns
            .sort((a: WorkerReturn, b: WorkerReturn) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            .map((ret: WorkerReturn) => this.formatWorkerReturnLine(ret));
          await this.showPanel("worker returns", lines);
        }
        this.statusLine = theme.info + "Loaded worker returns." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to load returns: " + (e?.message || String(e)) + ansi.reset;
      }
      return false;
    }
    if (command === "return") {
      if (!argText) {
        this.statusLine = theme.warning + "Usage: /return <id>" + ansi.reset;
        return false;
      }

      try {
        const ret = await this.client.getWorkerReturn(argText);
        const lines = [
          theme.textDim + "id: " + ansi.reset + ret.id,
          theme.textDim + "status: " + ansi.reset + statusBadge(ret.status),
          theme.textDim + "child: " + ansi.reset + theme.sessionId + ret.childSessionId + ansi.reset,
          theme.textDim + "alias: " + ansi.reset + (ret.alias ? theme.alias + ret.alias + ansi.reset : "(none)"),
          theme.textDim + "task: " + ansi.reset + ret.task,
          theme.textDim + "started: " + ansi.reset + ret.startedAt,
          theme.textDim + "finished: " + ansi.reset + (ret.finishedAt || "(running)"),
          theme.textDim + "trace: " + ansi.reset + (ret.traceRef || "(none)"),
          "",
          theme.text + "output:" + ansi.reset,
          theme.textDim + (ret.output ? truncate(ret.output, 500) : "(none)") + ansi.reset,
        ];

        await this.showPanel("worker return", lines);
        this.statusLine = theme.info + "Loaded worker return " + ret.id + "." + ansi.reset;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to get worker return: " + (e?.message || String(e)) + ansi.reset;
      }
      return false;
    }

    if (command === "sessions" || command === "s") {
      this.app.navigate({ type: "home" });
      return true;
    }

    if (command === "new") {
      try {
        const session = await this.client.createSession({ title: "New Session" });
        this.app.navigate({ type: "session", sessionId: session.id });
        return true;
      } catch (e: any) {
        this.statusLine = theme.error + "Failed to create session: " + (e?.message || String(e)) + ansi.reset;
        return false;
      }
    }

    if (command === "help" || command === "h") {
      await this.showPanel("commands", [
        theme.accent + "/thread <alias> <task>" + ansi.reset + " (or /t)",
        theme.accent + "/children" + ansi.reset + " (or /c)",
        theme.accent + "/inspect <alias-or-id>" + ansi.reset,
        theme.accent + "/returns" + ansi.reset + " (or /r)",
        theme.accent + "/return <id>" + ansi.reset,
        theme.accent + "/sessions" + ansi.reset + " (or /s)",
        theme.accent + "/new" + ansi.reset,
        theme.accent + "/help" + ansi.reset + " (or /h)",
        theme.accent + "/quit" + ansi.reset + " (or /q)",
      ]);
      this.statusLine = theme.info + "Displayed command help." + ansi.reset;
      return false;
    }

    if (command === "quit" || command === "q") {
      this.app.quit();
      return true;
    }

    this.statusLine = theme.warning + "Unknown command: /" + command + " (try /help)" + ansi.reset;
    return false;
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

  private formatWorkerReturnLine(ret: WorkerReturn): string {
    const alias = ret.alias ? theme.alias + ret.alias + ansi.reset : theme.textDim + "(no alias)" + ansi.reset;
    return "- " + ret.id + "  " + statusBadge(ret.status) + "  " + alias + "  " + truncate(ret.task, 40);
  }

  private async showPanel(title: string, lines: string[]): Promise<void> {
    write(ansi.clear);
    const { cols } = getTerminalSize();
    const width = Math.max(50, Math.min(cols, 120));
    writeln(box(" " + title + " ", lines.join("\n"), width));
    writeln();
    await this.app.prompt(theme.textDim + "  Press Enter to continue..." + ansi.reset + " ");
  }
}
