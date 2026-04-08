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
    rgb: (r: number, g: number, b: number) => ESC + "38;2;" + r + ";" + g + ";" + b + "m",
  },

  // Background
  bg: {
    black: ESC + "40m",
    red: ESC + "41m",
    blue: ESC + "44m",
    gray: ESC + "100m",
    rgb: (r: number, g: number, b: number) => ESC + "48;2;" + r + ";" + g + ";" + b + "m",
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
  const top = theme.border + "┌" + titleStr + "─".repeat(Math.max(0, topPad)) + "┐" + ansi.reset;
  const bottom = theme.border + "└" + "─".repeat(inner + 2) + "┘" + ansi.reset;

  const lines = content.split("\n").map((line) => {
    const visible = stripAnsi(line).length;
    const pad = Math.max(0, inner - visible);
    return theme.border + "│ " + ansi.reset + line + " ".repeat(pad) + theme.border + " │" + ansi.reset;
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
