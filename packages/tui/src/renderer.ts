/**
 * ANSI terminal renderer — minimal terminal UI primitives.
 * Inspired by opencode's OpenTUI approach but using raw ANSI for dogfooding.
 */

// ── ANSI Codes ───────────────────────────────────────────────────────

const ESC = "\x1b[";

export const ansi = {
  clear: ESC + "2J" + ESC + "H",
  clearLine: ESC + "2K",
  moveTo: (row: number, col: number) => ESC + row + ";" + col + "H",
  moveToCol: (col: number) => ESC + col + "G",
  hideCursor: ESC + "?25l",
  showCursor: ESC + "?25h",
  saveCursor: ESC + "s",
  restoreCursor: ESC + "u",
  scrollRegion: (top: number, bottom: number) => ESC + top + ";" + bottom + "r",
  resetScroll: ESC + "r",

  // Colors
  reset: ESC + "0m",
  bold: ESC + "1m",
  dim: ESC + "2m",
  italic: ESC + "3m",
  underline: ESC + "4m",

  // Foreground
  fg: {
    black: ESC + "30m",
    red: ESC + "31m",
    green: ESC + "32m",
    yellow: ESC + "33m",
    blue: ESC + "34m",
    magenta: ESC + "35m",
    cyan: ESC + "36m",
    white: ESC + "37m",
    gray: ESC + "90m",
    brightRed: ESC + "91m",
    brightGreen: ESC + "92m",
    brightYellow: ESC + "93m",
    brightBlue: ESC + "94m",
    brightMagenta: ESC + "95m",
    brightCyan: ESC + "96m",
    brightWhite: ESC + "97m",
    rgb: (r: number, g: number, b: number) =>
      ESC + "38;2;" + r + ";" + g + ";" + b + "m",
  },

  // Background
  bg: {
    black: ESC + "40m",
    red: ESC + "41m",
    blue: ESC + "44m",
    gray: ESC + "100m",
    rgb: (r: number, g: number, b: number) =>
      ESC + "48;2;" + r + ";" + g + ";" + b + "m",
  },
};

// ── Theme (opencode-inspired dark theme) ─────────────────────────────

export const theme = {
  bg: ansi.bg.rgb(17, 17, 27),
  surface: ansi.bg.rgb(24, 24, 37),
  border: ansi.fg.rgb(69, 71, 90),
  text: ansi.fg.rgb(205, 214, 244),
  textDim: ansi.fg.rgb(127, 132, 156),
  textMuted: ansi.fg.rgb(88, 91, 112),
  accent: ansi.fg.rgb(137, 180, 250),
  accentBold: ansi.bold + ansi.fg.rgb(137, 180, 250),
  success: ansi.fg.rgb(166, 227, 161),
  warning: ansi.fg.rgb(249, 226, 175),
  error: ansi.fg.rgb(243, 139, 168),
  info: ansi.fg.rgb(148, 226, 213),

  // Semantic
  sessionId: ansi.fg.rgb(180, 190, 254),
  alias: ansi.fg.rgb(245, 194, 231),
  status: {
    active: ansi.fg.rgb(166, 227, 161),
    completed: ansi.fg.rgb(137, 180, 250),
    failed: ansi.fg.rgb(243, 139, 168),
    aborted: ansi.fg.rgb(249, 226, 175),
    blocked: ansi.fg.rgb(249, 226, 175),
    paused: ansi.fg.rgb(127, 132, 156),
  },
  role: {
    user: ansi.bold + ansi.fg.rgb(137, 180, 250),
    assistant: ansi.bold + ansi.fg.rgb(166, 227, 161),
    system: ansi.bold + ansi.fg.rgb(249, 226, 175),
    tool: ansi.bold + ansi.fg.rgb(148, 226, 213),
  },
};

// ── Layout Helpers ───────────────────────────────────────────────────

export function getTerminalSize(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

export function box(title: string, content: string, width: number): string {
  const inner = width - 4;
  const titleStr = title ? " " + title + " " : "";
  const topPad = inner - stripAnsi(titleStr).length;
  const top =
    theme.border +
    "┌" +
    titleStr +
    "─".repeat(Math.max(0, topPad)) +
    "┐" +
    ansi.reset;
  const bottom = theme.border + "└" + "─".repeat(inner + 2) + "┘" + ansi.reset;

  const lines = content.split("\n").map((line) => {
    const visible = stripAnsi(line).length;
    const pad = Math.max(0, inner - visible);
    return (
      theme.border +
      "│ " +
      ansi.reset +
      line +
      " ".repeat(pad) +
      theme.border +
      " │" +
      ansi.reset
    );
  });

  return [top, ...lines, bottom].join("\n");
}

export function truncate(str: string, maxLen: number): string {
  const visible = stripAnsi(str);
  if (visible.length <= maxLen) return str;
  // Simple truncation — doesn't handle ANSI mid-sequence perfectly but good enough
  return str.slice(0, maxLen - 1) + "…";
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[\?[0-9]*[hl]/g, "");
}

export function padRight(str: string, width: number): string {
  const visible = stripAnsi(str).length;
  return str + " ".repeat(Math.max(0, width - visible));
}

export function horizontalRule(width: number): string {
  return theme.border + "─".repeat(width) + ansi.reset;
}

export function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    active: theme.status.active,
    completed: theme.status.completed,
    failed: theme.status.failed,
    aborted: theme.status.aborted,
    blocked: theme.status.blocked,
    paused: theme.status.paused,
  };
  const color = colors[status] || theme.textDim;
  const icons: Record<string, string> = {
    active: "●",
    completed: "✓",
    failed: "✗",
    aborted: "⊘",
    blocked: "◉",
    paused: "◦",
  };
  const icon = icons[status] || "?";
  return color + icon + " " + status + ansi.reset;
}

export function write(text: string): void {
  process.stdout.write(text);
}

export function writeln(text: string = ""): void {
  process.stdout.write(text + "\n");
}

// ── Spinner ──────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTick = 0;

export function spinner(label: string = ""): string {
  const frame = SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length]!;
  spinnerTick++;
  return theme.accent + frame + ansi.reset + (label ? " " + label : "");
}

export function resetSpinner(): void {
  spinnerTick = 0;
}

// ── Input Bar ────────────────────────────────────────────────────────

export function inputBar(
  prompt: string,
  value: string,
  cursorPos: number,
  cols: number,
): string {
  const promptVisible = stripAnsi(prompt).length;
  const maxInput = Math.max(10, cols - promptVisible - 2);
  const displayValue =
    value.length > maxInput ? value.slice(value.length - maxInput) : value;
  const adjustedCursor = value.length > maxInput ? maxInput : cursorPos;

  const before = displayValue.slice(0, adjustedCursor);
  const cursorChar = displayValue[adjustedCursor] || " ";
  const after = displayValue.slice(adjustedCursor + 1);

  return (
    prompt +
    theme.text +
    before +
    ansi.reset +
    ansi.bg.rgb(137, 180, 250) +
    ansi.fg.black +
    cursorChar +
    ansi.reset +
    theme.text +
    after +
    ansi.reset
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────

export function progressBar(
  current: number,
  total: number,
  width: number = 20,
): string {
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return (
    theme.accent +
    "█".repeat(filled) +
    ansi.reset +
    theme.textMuted +
    "░".repeat(empty) +
    ansi.reset +
    theme.textDim +
    " " +
    current +
    "/" +
    total +
    ansi.reset
  );
}

// ── Key Hint ─────────────────────────────────────────────────────────

export function keyHint(key: string, label: string): string {
  return (
    theme.border +
    "[" +
    ansi.reset +
    theme.accent +
    key +
    ansi.reset +
    theme.border +
    "]" +
    ansi.reset +
    theme.textDim +
    " " +
    label +
    ansi.reset
  );
}

// ── Subagent Card ────────────────────────────────────────────────────

export interface SubagentCardData {
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
  estimatedCostUsd?: number | null;
  model?: string | null;
  summary?: string | null;
  completionContractValidity?: "valid" | "missing" | "malformed" | null;
  delegationReason?: string | null;
  currentTool?: string | null;
  keyFindings?: string[];
  output?: string | null;
  reused?: boolean;
  iterations?: number;
  capabilities?: string[];
  inputEpisodeIds?: string[];
  liveActivity?: string;
}
function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

function formatCost(estimatedCostUsd: number | null | undefined): string {
  if (estimatedCostUsd == null || !Number.isFinite(estimatedCostUsd))
    return "—";
  if (estimatedCostUsd < 0.001) return "<$0.001";
  return "$" + estimatedCostUsd.toFixed(3);
}
export function subagentCards(
  cards: SubagentCardData[],
  cols: number,
): string[] {
  const lines: string[] = [];
  const cardWidth = Math.max(52, Math.min(cols - 4, 100));
  const innerWidth = cardWidth - 2;

  const title =
    "─ Ran " +
    cards.length +
    " subagent" +
    (cards.length !== 1 ? "s" : "") +
    " ";
  lines.push(
    "  " +
      theme.border +
      "┌" +
      title +
      "─".repeat(Math.max(0, innerWidth - title.length)) +
      "┐" +
      ansi.reset,
  );

  for (const card of cards) {
    const alias = card.alias || "(unnamed)";
    const aliasStyled = theme.alias + alias + ansi.reset;

    let statusIcon: string;
    if (card.liveActivity) {
      statusIcon = theme.warning + "⟳" + ansi.reset;
    } else if (card.status === "completed") {
      statusIcon = theme.success + "✓" + ansi.reset;
    } else if (card.status === "aborted" || card.status === "escalated") {
      statusIcon = theme.error + "✗" + ansi.reset;
    } else {
      statusIcon = theme.textDim + "●" + ansi.reset;
    }

    const dur = formatDuration(card.durationMs);
    const taskText = card.liveActivity || card.task;
    const metaRight =
      statusIcon +
      " " +
      statusBadge(card.status) +
      " " +
      theme.textDim +
      dur +
      ansi.reset;
    const metaRightLen = stripAnsi(metaRight).length;
    const leftBudget = innerWidth - 4 - metaRightLen - 2;
    const aliasLen = stripAnsi(aliasStyled).length;
    const taskBudget = Math.max(8, leftBudget - aliasLen - 2);
    const taskTrunc = truncate(taskText, taskBudget);

    const left1 =
      "  " +
      theme.textDim +
      "● " +
      ansi.reset +
      aliasStyled +
      "  " +
      theme.text +
      taskTrunc +
      ansi.reset;
    const left1Len = stripAnsi(left1).length;
    const gap1 = Math.max(1, innerWidth - 2 - left1Len - metaRightLen);
    lines.push(
      "  " +
        theme.border +
        "│ " +
        ansi.reset +
        left1 +
        " ".repeat(gap1) +
        metaRight +
        theme.border +
        " │" +
        ansi.reset,
    );

    const stats = [
      `${card.filesRead.length} read`,
      `${card.filesChanged.length} changed`,
      `${card.toolCallCount} tools`,
      card.tokenUsage ? `${card.tokenUsage.totalTokens} tok` : "tok:—",
      `cost ${formatCost(card.estimatedCostUsd)}`,
      card.iterations != null ? `iter ${card.iterations}` : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join(" · ");
    const statsLine = "    " + theme.textDim + stats + ansi.reset;
    const statsLen = stripAnsi(statsLine).length;
    const statsPad = Math.max(0, innerWidth - 2 - statsLen);
    lines.push(
      "  " +
        theme.border +
        "│ " +
        ansi.reset +
        statsLine +
        " ".repeat(statsPad) +
        theme.border +
        " │" +
        ansi.reset,
    );

    const detailParts = [
      card.currentTool ? `tool ${card.currentTool}` : null,
      card.model ? `model ${card.model}` : null,
      card.completionContractValidity
        ? `completion ${card.completionContractValidity}`
        : null,
      card.reused ? "reused" : null,
      card.delegationReason ? `why ${card.delegationReason}` : null,
    ].filter((x): x is string => Boolean(x));

    if (detailParts.length > 0) {
      const detailText =
        "    " +
        theme.textMuted +
        truncate(detailParts.join(" · "), innerWidth - 4) +
        ansi.reset;
      const detailLen = stripAnsi(detailText).length;
      const detailPad = Math.max(0, innerWidth - 2 - detailLen);
      lines.push(
        "  " +
          theme.border +
          "│ " +
          ansi.reset +
          detailText +
          " ".repeat(detailPad) +
          theme.border +
          " │" +
          ansi.reset,
      );
    }

    const summaryBits = [
      card.summary ? `summary ${card.summary}` : null,
      card.keyFindings && card.keyFindings.length > 0
        ? `${card.keyFindings.length} findings`
        : null,
      card.capabilities && card.capabilities.length > 0
        ? `caps ${card.capabilities.join(",")}`
        : null,
      card.inputEpisodeIds && card.inputEpisodeIds.length > 0
        ? `${card.inputEpisodeIds.length} inputs`
        : null,
    ].filter((x): x is string => Boolean(x));

    if (summaryBits.length > 0) {
      const summaryText =
        "    " +
        theme.text +
        truncate(summaryBits.join(" · "), innerWidth - 4) +
        ansi.reset;
      const summaryLen = stripAnsi(summaryText).length;
      const summaryPad = Math.max(0, innerWidth - 2 - summaryLen);
      lines.push(
        "  " +
          theme.border +
          "│ " +
          ansi.reset +
          summaryText +
          " ".repeat(summaryPad) +
          theme.border +
          " │" +
          ansi.reset,
      );
    }
  }
  lines.push(
    "  " + theme.border + "└" + "─".repeat(innerWidth) + "┘" + ansi.reset,
  );
  return lines;
}
