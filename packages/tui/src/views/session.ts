/**
 * Session view — raw-keypress terminal session with opencode-like layout.
 * Automatic orchestration is the primary message path.
 * SSE subscription provides live subagent activity.
 */

import type { OpenSlateClient, OrchestrateResponse } from "@openslate/sdk";
import type {
  Session,
  SessionId,
  Message,
  MessagePart,
  WorkerReturn,
  ThreadRunCard,
  OpenSlateEvent,
} from "@openslate/core";
import type { App } from "../app.js";
import { SubagentPickerView } from "./subagent-picker.js";
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
  box,
  spinner,
  resetSpinner,
  inputBar,
  keyHint,
  subagentCards,
  type SubagentCardData,
} from "../renderer.js";

// ── Types ───────────────────────────────────────────────────────────

type TranscriptEntry =
  | { type: "user"; message: Message }
  | { type: "assistant"; message: Message }
  | { type: "subagent-cards"; threadRuns: ThreadRunCard[] }
  | { type: "status"; text: string };

type LiveCard = {
  childSessionId: string;
  alias: string | null;
  task: string;
  status: string;
  durationMs: number | null;
  filesRead: string[];
  filesChanged: string[];
  toolCallCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  estimatedCostUsd: number | null;
  model: string | null;
  delegationReason: string | null;
  liveActivity?: string;
  startedAt: number;
};
// ── Session View ────────────────────────────────────────────────────

export class SessionView {
  private client: OpenSlateClient;
  private app: App;
  private sessionId: SessionId;

  private session: Session | null = null;
  private transcript: TranscriptEntry[] = [];
  private statusLine = "";
  private usage: OrchestrateResponse["usage"] = null;

  private inputBuffer = "";
  private cursorPos = 0;
  private scrollOffset = 0;
  private running = false;
  private suspended = false;
  private orchestrating = false;
  private renderTimer: ReturnType<typeof setInterval> | null = null;

  // Live SSE state
  private knownChildIds = new Set<string>();
  private liveCards = new Map<string, LiveCard>();

  constructor(client: OpenSlateClient, app: App, sessionId: SessionId) {
    this.client = client;
    this.app = app;
    this.sessionId = sessionId;
  }

  async run(): Promise<void> {
    this.running = true;
    await this.loadInitialState();
    this.startEventSubscription();

    // Render timer for spinner animation during orchestration
    this.renderTimer = setInterval(() => {
      if (this.orchestrating && !this.suspended) this.render();
    }, 200);

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    this.render();

    await new Promise<void>((resolve) => {
      const onData = (data: string | Buffer) => {
        if (this.suspended) return;
        const key = typeof data === "string" ? data : data.toString("utf8");
        this.handleKey(key, () => {
          cleanup();
          resolve();
        });
      };

      const cleanup = () => {
        process.stdin.removeListener("data", onData);
        if (this.renderTimer) clearInterval(this.renderTimer);
        this.renderTimer = null;
      };

      process.stdin.on("data", onData);
    });
  }

  // ── Initial Load ──────────────────────────────────────────────────

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
      this.statusLine =
        theme.error +
        "Failed to load session: " +
        (e?.message || String(e)) +
        ansi.reset;
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  private render(): void {
    const { cols, rows } = getTerminalSize();

    write(ansi.hideCursor);
    write(ansi.clear);

    // Header
    const sessionPrefix = this.sessionId.slice(0, 8);
    const status = this.session?.status || "active";
    const header =
      theme.accentBold +
      "  OpenSlate" +
      ansi.reset +
      theme.textDim +
      "  session " +
      ansi.reset +
      theme.sessionId +
      sessionPrefix +
      ansi.reset +
      theme.textDim +
      "  " +
      ansi.reset +
      statusBadge(status);
    writeln(header);
    writeln(horizontalRule(cols));

    // Build transcript lines + live cards
    const transcriptLines = this.renderTranscriptLines(cols);

    // Live subagent cards during orchestration
    let liveCardLines: string[] = [];
    if (this.orchestrating && this.liveCards.size > 0) {
      const cards: SubagentCardData[] = [];
      for (const lc of this.liveCards.values()) {
        cards.push({
          alias: lc.alias,
          task: lc.task,
          status: lc.status,
          durationMs:
            lc.status === "completed" || lc.status === "failed"
              ? lc.durationMs
              : Date.now() - lc.startedAt,
          filesRead: lc.filesRead,
          filesChanged: lc.filesChanged,
          toolCallCount: lc.toolCallCount,
          tokenUsage: lc.tokenUsage,
          estimatedCostUsd: lc.estimatedCostUsd,
          model: lc.model,
          delegationReason: lc.delegationReason,
          liveActivity: lc.liveActivity,
        });
      }
      liveCardLines = subagentCards(cards, cols);
    }
    const allContentLines = [...transcriptLines, ...liveCardLines];

    // Footer: status + usage (1) + input (1) + hints (1) = 3 lines below rule
    const reservedBottom = 4;
    const reservedTop = 2;
    const mainHeight = Math.max(4, rows - reservedTop - reservedBottom);

    // Bottom-anchored scrolling
    const maxScroll = Math.max(0, allContentLines.length - mainHeight);
    const effectiveScroll = Math.max(0, Math.min(this.scrollOffset, maxScroll));
    const startIdx = Math.max(
      0,
      allContentLines.length - mainHeight - effectiveScroll,
    );
    const visible = allContentLines.slice(startIdx, startIdx + mainHeight);

    for (const line of visible) {
      writeln(truncate(line, cols));
    }
    for (let i = visible.length; i < mainHeight; i++) {
      writeln("");
    }

    // Status + usage line
    const statusText = this.orchestrating
      ? spinner("Orchestrating...")
      : this.statusLine || theme.textDim + "Idle" + ansi.reset;

    const usageLine = this.usage
      ? theme.textDim +
        "p:" +
        this.usage.promptTokens +
        " " +
        "c:" +
        this.usage.completionTokens +
        " " +
        "t:" +
        this.usage.totalTokens +
        ansi.reset
      : "";

    const left =
      " " + truncate(statusText, Math.max(10, Math.floor(cols * 0.6)));
    const gap = Math.max(
      1,
      cols - stripAnsi(left).length - stripAnsi(usageLine).length - 1,
    );
    writeln(left + " ".repeat(gap) + usageLine);

    // Input bar
    const prompt = theme.accent + "  > " + ansi.reset;
    writeln(inputBar(prompt, this.inputBuffer, this.cursorPos, cols));

    // Key hints
    const hints = [
      keyHint("Ctrl+O", "subagents"),
      keyHint("Ctrl+B", "home"),
      keyHint("Ctrl+C", "quit"),
    ].join("  ");
    write(" " + hints);

    write(ansi.showCursor);
  }

  // ── Transcript Rendering ──────────────────────────────────────────

  private renderTranscriptLines(cols: number): string[] {
    const lines: string[] = [];

    if (this.transcript.length === 0) {
      lines.push(
        " " + theme.textDim + "No messages yet. Start typing." + ansi.reset,
      );
      return lines;
    }

    for (const entry of this.transcript) {
      if (entry.type === "user") {
        lines.push(
          ...this.renderMessage(entry.message, "You", theme.role.user, cols),
        );
      } else if (entry.type === "assistant") {
        lines.push(
          ...this.renderMessage(
            entry.message,
            "OpenSlate",
            theme.role.assistant,
            cols,
          ),
        );
      } else if (entry.type === "subagent-cards") {
        lines.push(
          ...this.renderSubagentCardsTranscript(entry.threadRuns, cols),
        );
        lines.push("");
      } else {
        lines.push(" " + theme.textDim + entry.text + ansi.reset);
        lines.push("");
      }
    }

    return lines;
  }

  private renderMessage(
    message: Message,
    label: string,
    color: string,
    cols: number,
  ): string[] {
    const lines: string[] = [];
    const ts = new Date(message.createdAt).toLocaleTimeString();
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
      lines.push(...this.renderMessagePart(part, cols));
    }
    lines.push("");
    return lines;
  }

  private renderMessagePart(part: MessagePart, cols: number): string[] {
    const out: string[] = [];
    const width = Math.max(20, cols - 2);

    if (part.kind === "text") {
      for (const row of part.content.split("\n"))
        out.push("  " + truncate(theme.text + row + ansi.reset, width));
      return out;
    }
    if (part.kind === "reasoning") {
      for (const row of part.content.split("\n"))
        out.push(
          "  " + truncate(theme.textDim + "... " + row + ansi.reset, width),
        );
      return out;
    }
    if (part.kind === "status") {
      out.push("  " + truncate(theme.info + part.content + ansi.reset, width));
      return out;
    }
    if (part.kind === "tool_call") {
      const args = this.safeJson(part.args);
      out.push(
        "  " +
          truncate(
            theme.role.tool +
              "-> " +
              part.toolName +
              ansi.reset +
              " " +
              theme.textDim +
              args +
              ansi.reset,
            width,
          ),
      );
      return out;
    }
    if (part.kind === "tool_result") {
      const tone = part.isError ? theme.error : theme.info;
      const text = part.content
        ? part.content.replace(/\s+/g, " ").trim()
        : "(empty)";
      out.push("  " + truncate(tone + "-> " + text + ansi.reset, width));
      return out;
    }
    if (part.kind === "worker_return_ref") {
      out.push(
        "  " +
          truncate(
            theme.warning +
              "-> worker return " +
              part.workerReturnId +
              ansi.reset,
            width,
          ),
      );
      return out;
    }
    if (part.kind === "delegation_plan") {
      out.push(
        "  " +
          truncate(
            theme.info + "delegation plan " + part.planId + ansi.reset,
            width,
          ),
      );
      for (const entry of part.entries) {
        const reason = entry.reason ? ` (${entry.reason})` : "";
        out.push(
          "  " +
            truncate(
              theme.textDim +
                `- ${entry.alias}: ${entry.task}${reason}` +
                ansi.reset,
              width,
            ),
        );
      }
      return out;
    }
    out.push(
      "  " +
        truncate(theme.textDim + "[" + part.kind + "]" + ansi.reset, width),
    );
    return out;
  }

  private renderSubagentCardsTranscript(
    threadRuns: ThreadRunCard[],
    cols: number,
  ): string[] {
    const cards: SubagentCardData[] = threadRuns.map((run) => ({
      alias: run.alias,
      task: run.task,
      status: run.status,
      durationMs: run.durationMs,
      filesRead: run.filesRead,
      filesChanged: run.filesChanged,
      toolCallCount: run.toolCallCount,
      tokenUsage: run.tokenUsage,
      estimatedCostUsd: run.estimatedCostUsd,
      model: run.model,
      delegationReason: run.delegationReason,
    }));
    return subagentCards(cards, cols);
  }
  // ── Key Handling ──────────────────────────────────────────────────

  private handleKey(key: string, exit: () => void): void {
    // Ctrl+C
    if (key === "\x03") {
      this.running = false;
      this.app.quit();
      exit();
      return;
    }
    // Ctrl+B
    if (key === "\x02") {
      this.running = false;
      this.app.navigate({ type: "home" });
      exit();
      return;
    }
    // Ctrl+O
    if (key === "\x0f") {
      this.openPicker(exit);
      return;
    }

    // Block typing during orchestration (controls above still work)
    if (this.orchestrating) return;

    // Enter
    if (key === "\r" || key === "\n") {
      if (this.inputBuffer.trim()) {
        const content = this.inputBuffer;
        this.inputBuffer = "";
        this.cursorPos = 0;
        this.submitInput(content, exit);
      }
      return;
    }
    // Backspace
    if (key === "\x7f" || key === "\b") {
      if (this.cursorPos > 0) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPos - 1) +
          this.inputBuffer.slice(this.cursorPos);
        this.cursorPos--;
        this.render();
      }
      return;
    }
    // Arrow up — scroll
    if (key === "\x1b[A") {
      this.scrollOffset = Math.min(this.scrollOffset + 1, 9999);
      this.render();
      return;
    }
    // Arrow down — scroll
    if (key === "\x1b[B") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.render();
      return;
    }
    // Arrow left
    if (key === "\x1b[D") {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      this.render();
      return;
    }
    // Arrow right
    if (key === "\x1b[C") {
      this.cursorPos = Math.min(this.inputBuffer.length, this.cursorPos + 1);
      this.render();
      return;
    }
    // Home / Ctrl+A
    if (key === "\x1b[H" || key === "\x01") {
      this.cursorPos = 0;
      this.render();
      return;
    }
    // End / Ctrl+E
    if (key === "\x1b[F" || key === "\x05") {
      this.cursorPos = this.inputBuffer.length;
      this.render();
      return;
    }
    // Delete
    if (key === "\x1b[3~") {
      if (this.cursorPos < this.inputBuffer.length) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.cursorPos) +
          this.inputBuffer.slice(this.cursorPos + 1);
        this.render();
      }
      return;
    }
    // Ctrl+U — clear line
    if (key === "\x15") {
      this.inputBuffer = "";
      this.cursorPos = 0;
      this.render();
      return;
    }
    // Ignore escape sequences
    if (key.startsWith("\x1b")) return;

    // Printable characters (single or multi-byte like emoji)
    if (key >= " " || (key.length > 1 && !key.startsWith("\x1b"))) {
      this.inputBuffer =
        this.inputBuffer.slice(0, this.cursorPos) +
        key +
        this.inputBuffer.slice(this.cursorPos);
      this.cursorPos += key.length;
      this.scrollOffset = 0;
      this.render();
    }
  }

  // ── Submit ────────────────────────────────────────────────────────

  private submitInput(content: string, exit: () => void): void {
    if (content.startsWith("/")) {
      this.handleSlashCommand(content, exit);
      return;
    }
    this.orchestrateMessage(content);
  }

  // ── Orchestration ─────────────────────────────────────────────────

  private async orchestrateMessage(content: string): Promise<void> {
    this.orchestrating = true;
    this.liveCards.clear();
    this.knownChildIds.clear();
    resetSpinner();
    this.scrollOffset = 0;
    this.render();

    try {
      const result = await this.client.orchestrate(this.sessionId, content);

      this.transcript.push({ type: "user", message: result.userMessage });
      if (result.threadRuns.length > 0) {
        this.transcript.push({
          type: "subagent-cards",
          threadRuns: result.threadRuns,
        });
      }
      this.transcript.push({
        type: "assistant",
        message: result.assistantMessage,
      });

      this.usage = result.usage;
      this.statusLine = theme.success + "Delivered." + ansi.reset;
      this.refreshSession();
    } catch (e: any) {
      this.statusLine =
        theme.error +
        "Orchestrate failed: " +
        (e?.message || String(e)) +
        ansi.reset;
    } finally {
      this.orchestrating = false;
      this.liveCards.clear();
      this.scrollOffset = 0;
      this.render();
    }
  }

  private async refreshSession(): Promise<void> {
    try {
      this.session = await this.client.getSession(this.sessionId);
    } catch {
      /* non-fatal */
    }
  }

  // ── SSE Event Subscription ────────────────────────────────────────

  private startEventSubscription(): void {
    const loop = async () => {
      try {
        for await (const event of this.client.subscribe()) {
          if (!this.running) break;
          this.handleEvent(event);
        }
      } catch {
        // SSE lost; best-effort retry
        if (this.running) setTimeout(() => this.startEventSubscription(), 3000);
      }
    };
    loop();
  }

  private handleEvent(event: OpenSlateEvent): void {
    const p = event.payload as Record<string, any>;

    if (event.type === "thread.created" || event.type === "thread.reused") {
      if (p.parentSessionId !== this.sessionId) return;
      const childId = p.childSessionId as string;
      this.knownChildIds.add(childId);
      this.liveCards.set(childId, {
        childSessionId: childId,
        alias: (p.alias as string) || null,
        task: (p.task as string) || "",
        status: event.type === "thread.reused" ? "reused" : "created",
        durationMs: null,
        filesRead: [],
        filesChanged: [],
        toolCallCount: 0,
        tokenUsage: null,
        estimatedCostUsd: null,
        model: null,
        delegationReason: null,
        liveActivity:
          event.type === "thread.reused" ? "Reusing thread..." : "Starting...",
        startedAt: Date.now(),
      });
      return;
    }
    const childSessionId = p.childSessionId as string | undefined;
    if (!childSessionId || !this.knownChildIds.has(childSessionId)) return;
    const card = this.liveCards.get(childSessionId);
    if (!card) return;

    if (event.type === "thread.started") {
      card.status = "running";
      card.liveActivity = "Running...";
    } else if (event.type === "thread.activity") {
      card.liveActivity = (p.activity as string) || "Working...";
    } else if (event.type === "thread.tool_started") {
      card.toolCallCount++;
      card.liveActivity = "Running " + (p.toolName as string) + "...";
    } else if (event.type === "thread.tool_completed") {
      card.liveActivity = "Finished " + (p.toolName as string);
    } else if (event.type === "thread.completed") {
      card.status = "completed";
      card.durationMs = Date.now() - card.startedAt;
      card.liveActivity = undefined;
    } else if (event.type === "thread.failed") {
      card.status = "failed";
      card.durationMs = Date.now() - card.startedAt;
      card.liveActivity = undefined;
    } else if (event.type === "worker_return.created") {
      card.status = (p.status as string) || "completed";
      card.durationMs = Date.now() - card.startedAt;
      card.liveActivity = undefined;
    }
  }

  // ── Subagent Picker ───────────────────────────────────────────────

  private async openPicker(exit: () => void): Promise<void> {
    this.suspended = true;
    if (process.stdin.isTTY && (process.stdin as any).isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    const picker = new SubagentPickerView(this.client, this.sessionId);
    const childId = await picker.choose();

    if (childId) {
      this.running = false;
      this.app.navigate({
        type: "subagent",
        sessionId: this.sessionId,
        childSessionId: childId,
      });
      this.suspended = false;
      exit();
      return;
    }

    this.suspended = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    this.render();
  }

  // ── Slash Commands ────────────────────────────────────────────────

  private async handleSlashCommand(
    input: string,
    exit: () => void,
  ): Promise<void> {
    const raw = input.slice(1).trim();
    const [cmdRaw, ...rest] = raw.split(/\s+/);
    const command = (cmdRaw || "").toLowerCase();
    const argText = rest.join(" ").trim();

    if (!command) {
      this.statusLine =
        theme.warning + "Empty command. Use /help." + ansi.reset;
      this.render();
      return;
    }

    if (command === "thread" || command === "t") {
      await this.cmdThread(argText);
      this.render();
      return;
    }
    if (command === "inspect" || command === "i") {
      await this.cmdInspect(argText);
      this.render();
      return;
    }
    if (command === "children" || command === "c") {
      await this.cmdChildren();
      this.render();
      return;
    }
    if (command === "returns" || command === "r") {
      await this.cmdReturns();
      this.render();
      return;
    }

    if (command === "sessions" || command === "s") {
      this.running = false;
      this.app.navigate({ type: "home" });
      exit();
      return;
    }

    if (command === "new") {
      try {
        const created = await this.client.createSession({
          title: "New Session",
        });
        this.running = false;
        this.app.navigate({ type: "session", sessionId: created.id });
        exit();
      } catch (e: any) {
        this.statusLine =
          theme.error + "Failed: " + (e?.message || String(e)) + ansi.reset;
        this.render();
      }
      return;
    }

    if (command === "help" || command === "h") {
      await this.showPanel("commands", [
        theme.accent +
          "/thread <alias> <task>" +
          ansi.reset +
          "  spawn a child thread",
        theme.accent +
          "/inspect <alias-or-id>" +
          ansi.reset +
          "  inspect a child",
        theme.accent + "/children" + ansi.reset + "  list child sessions",
        theme.accent + "/returns" + ansi.reset + "  list worker returns",
        theme.accent + "/sessions" + ansi.reset + "  go to session list",
        theme.accent + "/new" + ansi.reset + "  create new session",
        theme.accent + "/login" + ansi.reset + "  configure provider auth",
        theme.accent + "/config" + ansi.reset + "  show config",
        theme.accent + "/model" + ansi.reset + "  show model roles",
        theme.accent + "/quit" + ansi.reset + "  quit app",
        "",
        theme.textDim + "Ctrl+O  subagent picker" + ansi.reset,
        theme.textDim + "Ctrl+B  back to home" + ansi.reset,
        theme.textDim + "Ctrl+C  quit" + ansi.reset,
      ]);
      return;
    }

    if (command === "quit" || command === "q") {
      this.running = false;
      this.app.quit();
      exit();
      return;
    }

    if (command === "login") {
      await this.cmdLogin();
      this.render();
      return;
    }
    if (command === "config") {
      await this.cmdConfig();
      this.render();
      return;
    }
    if (command === "model") {
      await this.cmdModel();
      this.render();
      return;
    }

    this.statusLine =
      theme.warning +
      "Unknown command: /" +
      command +
      " (try /help)" +
      ansi.reset;
    this.render();
  }

  // ── Command Implementations ───────────────────────────────────────

  private async cmdThread(argText: string): Promise<void> {
    const parsed = this.parseAliasTask(argText);
    if (!parsed) {
      this.statusLine =
        theme.warning + "Usage: /thread <alias> <task>" + ansi.reset;
      return;
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
        summary: spawned.workerReturn.summary ?? null,
        keyFindings: spawned.workerReturn.keyFindings ?? [],
        filesRead: spawned.workerReturn.filesRead ?? [],
        filesChanged: spawned.workerReturn.filesChanged ?? [],
        toolCallCount: spawned.workerReturn.toolCalls?.length ?? 0,
        durationMs: spawned.workerReturn.durationMs ?? null,
        model: spawned.workerReturn.model ?? null,
        tokenUsage: spawned.workerReturn.tokenUsage ?? null,
        estimatedCostUsd: spawned.workerReturn.estimatedCostUsd ?? null,
        completionContractValidity:
          spawned.workerReturn.completionContract?.validity ?? null,
        workerReturnId: spawned.workerReturn.id,
        startedAt: spawned.workerReturn.startedAt,
        finishedAt: spawned.workerReturn.finishedAt,
        delegationReason: null,
        expectedOutput: null,
        capabilities: ["read", "search"],
      };
      this.transcript.push({ type: "subagent-cards", threadRuns: [card] });
      this.statusLine = theme.success + "Thread spawned." + ansi.reset;
      this.scrollOffset = 0;
      this.refreshSession();
    } catch (e: any) {
      this.statusLine =
        theme.error +
        "Thread spawn failed: " +
        (e?.message || String(e)) +
        ansi.reset;
    }
  }

  private async cmdInspect(argText: string): Promise<void> {
    if (!argText) {
      this.statusLine =
        theme.warning + "Usage: /inspect <alias-or-id>" + ansi.reset;
      return;
    }
    const local = this.findLocalThreadRun(argText);
    if (local) {
      await this.showPanel("inspect", this.inspectLinesFromThreadRun(local));
      return;
    }

    try {
      const children = await this.client.listChildren(this.sessionId);
      const child =
        children.find((c) => c.alias === argText) ||
        children.find((c) => c.id === argText) ||
        children.find((c) => c.id.startsWith(argText));

      if (!child) {
        await this.showPanel("inspect", [
          theme.warning + "No child found for: " + argText + ansi.reset,
        ]);
        return;
      }

      const returns = await this.client.listWorkerReturns(this.sessionId);
      const childMessages = await this.client.getChildMessages(
        this.sessionId,
        child.id,
      );
      await this.showPanel(
        "inspect",
        this.buildChildInspectLines(child, returns, childMessages),
      );
    } catch (e: any) {
      this.statusLine =
        theme.error +
        "Inspect failed: " +
        (e?.message || String(e)) +
        ansi.reset;
    }
  }

  private async cmdChildren(): Promise<void> {
    try {
      const children = await this.client.listChildren(this.sessionId);
      if (children.length === 0) {
        await this.showPanel("children", [
          theme.textDim + "No child sessions." + ansi.reset,
        ]);
      } else {
        const lines = children
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )
          .map(
            (c) =>
              "- " +
              (c.alias
                ? theme.alias + c.alias + ansi.reset
                : theme.textDim + "(no alias)" + ansi.reset) +
              "  " +
              theme.sessionId +
              c.id.slice(0, 12) +
              ansi.reset +
              "  " +
              statusBadge(c.status),
          );
        await this.showPanel("children", lines);
      }
    } catch (e: any) {
      this.statusLine =
        theme.error + "Failed: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async cmdReturns(): Promise<void> {
    try {
      const returns = await this.client.listWorkerReturns(this.sessionId);
      if (returns.length === 0) {
        await this.showPanel("worker returns", [
          theme.textDim + "No worker returns yet." + ansi.reset,
        ]);
      } else {
        const lines = returns
          .sort(
            (a, b) =>
              new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          )
          .map(
            (r) =>
              "- " +
              r.id.slice(0, 12) +
              "  " +
              statusBadge(r.status) +
              "  " +
              (r.alias
                ? theme.alias + r.alias + ansi.reset
                : theme.textDim + "(no alias)" + ansi.reset) +
              "  " +
              truncate(r.task, 56),
          );
        await this.showPanel("worker returns", lines);
      }
    } catch (e: any) {
      this.statusLine =
        theme.error + "Failed: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async cmdLogin(): Promise<void> {
    if (process.stdin.isTTY && (process.stdin as any).isRaw)
      process.stdin.setRawMode(false);
    this.suspended = true;
    try {
      const provider = await this.app.prompt(
        theme.accent + "  Provider (anthropic/openai): " + ansi.reset,
      );
      if (!provider) {
        this.statusLine = theme.warning + "Login cancelled." + ansi.reset;
        return;
      }
      const apiKey = await this.app.prompt(
        theme.accent + "  API Key: " + ansi.reset,
      );
      if (!apiKey) {
        this.statusLine = theme.warning + "Login cancelled." + ansi.reset;
        return;
      }
      const result = await this.client.login(provider, apiKey);
      this.statusLine = result.ok
        ? theme.success + "Logged in to " + result.provider + "." + ansi.reset
        : theme.error + "Login failed." + ansi.reset;
    } catch (e: any) {
      this.statusLine =
        theme.error + "Login error: " + (e?.message || String(e)) + ansi.reset;
    } finally {
      this.suspended = false;
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
    }
  }

  private async cmdConfig(): Promise<void> {
    try {
      const config = await this.client.getConfig();
      const lines: string[] = [theme.text + "Providers:" + ansi.reset];
      for (const [name, info] of Object.entries(config.providers)) {
        const badge = info.configured
          ? theme.success + "configured" + ansi.reset
          : theme.textDim + "not configured" + ansi.reset;
        lines.push(
          "  " +
            theme.alias +
            name +
            ansi.reset +
            "  " +
            badge +
            "  " +
            theme.textDim +
            "(" +
            info.authType +
            ")" +
            ansi.reset,
        );
      }
      lines.push("", theme.text + "Models:" + ansi.reset);
      for (const role of [
        "primary",
        "execute",
        "explore",
        "search",
        "compress",
      ] as const) {
        const value = config.models[role];
        lines.push(
          "  " +
            role +
            ": " +
            (value
              ? theme.info + value.provider + "/" + value.model + ansi.reset
              : theme.textDim + "(not set)" + ansi.reset),
        );
      }
      await this.showPanel("config", lines);
    } catch (e: any) {
      this.statusLine =
        theme.error + "Config error: " + (e?.message || String(e)) + ansi.reset;
    }
  }

  private async cmdModel(): Promise<void> {
    try {
      const config = await this.client.getConfig();
      const lines: string[] = [
        theme.text + "Model Role Assignments:" + ansi.reset,
        "",
      ];

      for (const role of [
        "primary",
        "execute",
        "explore",
        "search",
        "compress",
      ] as const) {
        lines.push("  " + theme.accent + role + ansi.reset + ":");
        const value = config.models[role];
        lines.push(
          "    " +
            (value
              ? theme.info + value.provider + "/" + value.model + ansi.reset
              : theme.textDim + "(not set)" + ansi.reset),
        );
        lines.push("");
      }

      await this.showPanel("model roles", lines);
    } catch (e: any) {
      this.statusLine =
        theme.error +
        "Model config error: " +
        (e?.message || String(e)) +
        ansi.reset;
    }
  }
  // ── Panel (modal overlay) ─────────────────────────────────────────

  private async showPanel(title: string, lines: string[]): Promise<void> {
    if (process.stdin.isTTY && (process.stdin as any).isRaw)
      process.stdin.setRawMode(false);
    this.suspended = true;
    write(ansi.clear);
    const { cols } = getTerminalSize();
    const width = Math.max(54, Math.min(cols, 120));
    writeln(box(" " + title + " ", lines.join("\n"), width));
    writeln();
    await this.app.prompt(
      theme.textDim + "  Press Enter to continue..." + ansi.reset + " ",
    );
    this.suspended = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    this.render();
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private findLocalThreadRun(selector: string): ThreadRunCard | null {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const entry = this.transcript[i];
      if (!entry || entry.type !== "subagent-cards") continue;
      const match = entry.threadRuns.find(
        (r) =>
          r.alias === selector ||
          r.childSessionId === selector ||
          r.childSessionId.startsWith(selector) ||
          r.workerReturnId === selector,
      );
      if (match) return match;
    }
    return null;
  }

  private inspectLinesFromThreadRun(run: ThreadRunCard): string[] {
    const lines = [
      theme.textDim +
        "child id: " +
        ansi.reset +
        theme.sessionId +
        run.childSessionId +
        ansi.reset,
      theme.textDim +
        "alias: " +
        ansi.reset +
        theme.alias +
        (run.alias || "(none)") +
        ansi.reset,
      theme.textDim + "task: " + ansi.reset + run.task,
      theme.textDim + "status: " + ansi.reset + statusBadge(run.status),
      theme.textDim + "reused: " + ansi.reset + (run.reused ? "yes" : "no"),
      theme.textDim + "model: " + ansi.reset + (run.model || "(unknown)"),
      theme.textDim + "worker return: " + ansi.reset + run.workerReturnId,
      theme.textDim +
        "completion contract: " +
        ansi.reset +
        (run.completionContractValidity || "unknown"),
      theme.textDim +
        "duration: " +
        ansi.reset +
        (run.durationMs != null
          ? (run.durationMs / 1000).toFixed(1) + "s"
          : "--"),
      theme.textDim +
        "estimated cost: " +
        ansi.reset +
        (run.estimatedCostUsd != null
          ? "$" + run.estimatedCostUsd.toFixed(4)
          : "--"),
      theme.textDim + "started: " + ansi.reset + run.startedAt,
      theme.textDim +
        "finished: " +
        ansi.reset +
        (run.finishedAt || "(running)"),
    ];
    if (run.summary)
      lines.push("", theme.text + "Summary:" + ansi.reset, "  " + run.summary);
    if (run.keyFindings.length > 0) {
      lines.push("", theme.text + "Key Findings:" + ansi.reset);
      for (const f of run.keyFindings) lines.push("  - " + f);
    }
    if (run.filesRead.length > 0 || run.filesChanged.length > 0) {
      lines.push("", theme.text + "Files:" + ansi.reset);
      for (const f of run.filesRead) lines.push("  read  " + f);
      for (const f of run.filesChanged)
        lines.push("  " + theme.warning + "write" + ansi.reset + " " + f);
    }
    if (run.output)
      lines.push(
        "",
        theme.text + "Output:" + ansi.reset,
        "  " + truncate(run.output, 600),
      );
    return lines;
  }

  private buildChildInspectLines(
    child: Session,
    returns: WorkerReturn[],
    childMessages: Message[],
  ): string[] {
    const childReturns = returns
      .filter((r) => r.childSessionId === child.id)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    const latest = childReturns[0];
    const toolCalls = childMessages
      .flatMap((m) => m.parts)
      .filter(
        (p): p is Extract<MessagePart, { kind: "tool_call" }> =>
          p.kind === "tool_call",
      );
    const toolResults = childMessages
      .flatMap((m) => m.parts)
      .filter(
        (p): p is Extract<MessagePart, { kind: "tool_result" }> =>
          p.kind === "tool_result",
      );

    const lines: string[] = [
      theme.textDim +
        "child id: " +
        ansi.reset +
        theme.sessionId +
        child.id +
        ansi.reset,
      theme.textDim +
        "alias: " +
        ansi.reset +
        theme.alias +
        (child.alias || "(none)") +
        ansi.reset,
      theme.textDim + "task: " + ansi.reset + (latest?.task || "(unknown)"),
      theme.textDim +
        "status: " +
        ansi.reset +
        statusBadge(latest?.status || child.status),
      theme.textDim + "messages: " + ansi.reset + String(childMessages.length),
      theme.textDim + "tool calls: " + ansi.reset + String(toolCalls.length),
      theme.textDim +
        "tool results: " +
        ansi.reset +
        String(toolResults.length),
    ];

    if (latest?.summary)
      lines.push(
        "",
        theme.text + "Summary:" + ansi.reset,
        "  " + latest.summary,
      );
    if (latest?.keyFindings && latest.keyFindings.length > 0) {
      lines.push("", theme.text + "Key Findings:" + ansi.reset);
      for (const f of latest.keyFindings) lines.push("  - " + f);
    }

    lines.push("", theme.text + "Worker Returns:" + ansi.reset);
    if (childReturns.length === 0) {
      lines.push(theme.textDim + "  (none)" + ansi.reset);
    } else {
      for (const ret of childReturns.slice(0, 6))
        lines.push(
          "  - " +
            ret.id.slice(0, 12) +
            "  " +
            statusBadge(ret.status) +
            "  " +
            truncate(ret.task, 72),
        );
    }

    lines.push("", theme.text + "Tool Calls:" + ansi.reset);
    if (toolCalls.length === 0) {
      lines.push(theme.textDim + "  (none)" + ansi.reset);
    } else {
      for (const call of toolCalls.slice(0, 10))
        lines.push(
          "  - " +
            call.toolName +
            " " +
            theme.textDim +
            this.safeJson(call.args) +
            ansi.reset,
        );
      if (toolCalls.length > 10)
        lines.push(
          theme.textDim +
            "  ... and " +
            (toolCalls.length - 10) +
            " more" +
            ansi.reset,
        );
    }

    lines.push("", theme.text + "Recent Messages:" + ansi.reset);
    const recent = childMessages.slice(Math.max(0, childMessages.length - 6));
    if (recent.length === 0) {
      lines.push(theme.textDim + "  (none)" + ansi.reset);
    } else {
      for (const msg of recent) {
        const text = msg.parts
          .filter(
            (p): p is Extract<MessagePart, { kind: "text" }> =>
              p.kind === "text",
          )
          .map((p) => p.content)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        lines.push(
          "  [" + msg.role + "] " + truncate(text || "(non-text parts)", 96),
        );
      }
    }
    return lines;
  }

  private parseAliasTask(
    argText: string,
  ): { alias: string; task: string } | null {
    const match = argText.match(/^(\S+)\s+([\s\S]+)$/);
    if (!match) return null;
    const alias = match[1]!.trim();
    let task = match[2]!.trim();
    if (
      (task.startsWith('"') && task.endsWith('"') && task.length >= 2) ||
      (task.startsWith("'") && task.endsWith("'") && task.length >= 2)
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
      return "{...}";
    }
  }
}
