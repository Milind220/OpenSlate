/**
 * Subagent picker — centered dialog listing child sessions.
 * Uses raw key handling for arrow navigation, Enter to select, Escape/Ctrl+B to cancel.
 */

import type { OpenSlateClient } from "@openslate/sdk";
import type { Session, SessionId, WorkerReturn } from "@openslate/core";
import {
  ansi,
  theme,
  getTerminalSize,
  write,
  box,
  truncate,
  stripAnsi,
  padRight,
  statusBadge,
  keyHint,
} from "../renderer.js";

interface PickerItem {
  childSessionId: SessionId;
  alias: string;
  status: string;
  task: string;
  duration: string;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

function durationFromReturn(ret: WorkerReturn | undefined): string {
  if (!ret?.finishedAt) return "—";
  const started = Date.parse(ret.startedAt);
  const finished = Date.parse(ret.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return "—";
  return formatDuration(Math.max(0, finished - started));
}
export class SubagentPickerView {
  private client: OpenSlateClient;
  private sessionId: SessionId;

  constructor(client: OpenSlateClient, sessionId: SessionId) {
    this.client = client;
    this.sessionId = sessionId;
  }

  async choose(): Promise<SessionId | null> {
    // Fetch children and worker returns
    const [children, workerReturns] = await Promise.all([
      this.client.listChildren(this.sessionId),
      this.client.listWorkerReturns(this.sessionId),
    ]);

    // Build a map of latest worker return per child for task/duration info
    const returnsByChild = new Map<string, WorkerReturn>();
    for (const ret of workerReturns) {
      const existing = returnsByChild.get(ret.childSessionId);
      if (
        !existing ||
        new Date(ret.startedAt).getTime() >
          new Date(existing.startedAt).getTime()
      ) {
        returnsByChild.set(ret.childSessionId, ret);
      }
    }

    // Build picker items
    const items: PickerItem[] = children.map((child) => {
      const ret = returnsByChild.get(child.id);
      return {
        childSessionId: child.id,
        alias: child.alias || "(unnamed)",
        status: ret?.status || child.status,
        task: ret?.task || child.title || "(no task)",
        duration: durationFromReturn(ret),
      };
    });

    // Handle empty case
    if (items.length === 0) {
      return this.showEmpty();
    }

    return this.showPicker(items);
  }

  private showEmpty(): Promise<SessionId | null> {
    return new Promise<SessionId | null>((resolve) => {
      const render = () => {
        const { rows, cols } = getTerminalSize();
        const dialogWidth = Math.min(50, cols - 4);
        const content = [
          "",
          theme.textDim + "  No child sessions found." + ansi.reset,
          "",
          "  " + keyHint("Enter", "close") + "  " + keyHint("Esc", "close"),
          "",
        ].join("\n");

        const rendered = box(" Subagents ", content, dialogWidth);
        const boxLines = rendered.split("\n");

        // Center vertically
        const startRow = Math.max(1, Math.floor((rows - boxLines.length) / 2));
        const startCol = Math.max(1, Math.floor((cols - dialogWidth) / 2));

        write(ansi.clear);
        for (let i = 0; i < boxLines.length; i++) {
          write(ansi.moveTo(startRow + i, startCol) + boxLines[i]!);
        }
      };

      render();

      const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (data: Buffer) => {
        const key = data.toString();
        // Enter, Escape, or Ctrl+B
        if (key === "\r" || key === "\x1b" || key === "\x02") {
          cleanup();
          resolve(null);
        }
      };

      const cleanup = () => {
        process.stdin.removeListener("data", onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(!!wasRaw);
      };

      process.stdin.on("data", onData);
    });
  }

  private showPicker(items: PickerItem[]): Promise<SessionId | null> {
    let selected = 0;

    return new Promise<SessionId | null>((resolve) => {
      const render = () => {
        const { rows, cols } = getTerminalSize();
        const dialogWidth = Math.min(80, cols - 4);
        const innerWidth = dialogWidth - 4;

        const lines: string[] = [""];

        // Header row
        const hdrAlias = padRight(theme.textDim + "Alias" + ansi.reset, 16);
        const hdrStatus = padRight(theme.textDim + "Status" + ansi.reset, 14);
        const hdrTask = padRight(
          theme.textDim + "Task" + ansi.reset,
          Math.max(10, innerWidth - 40),
        );
        const hdrDur = theme.textDim + "Duration" + ansi.reset;
        lines.push(
          "  " + hdrAlias + " " + hdrStatus + " " + hdrTask + " " + hdrDur,
        );
        lines.push("");

        // Limit visible items to fit in dialog
        const maxVisible = Math.min(items.length, Math.max(5, rows - 12));
        let scrollOffset = 0;
        if (selected >= scrollOffset + maxVisible) {
          scrollOffset = selected - maxVisible + 1;
        }
        if (selected < scrollOffset) {
          scrollOffset = selected;
        }

        const visibleItems = items.slice(
          scrollOffset,
          scrollOffset + maxVisible,
        );

        for (let i = 0; i < visibleItems.length; i++) {
          const item = visibleItems[i]!;
          const idx = scrollOffset + i;
          const isSelected = idx === selected;

          const pointer = isSelected ? theme.accent + "▸ " + ansi.reset : "  ";

          const aliasBudget = 14;
          const aliasStr = isSelected
            ? theme.accentBold + truncate(item.alias, aliasBudget) + ansi.reset
            : theme.alias + truncate(item.alias, aliasBudget) + ansi.reset;

          const statusStr = statusBadge(item.status);

          const taskBudget = Math.max(10, innerWidth - 42);
          const taskStr =
            theme.text + truncate(item.task, taskBudget) + ansi.reset;

          const durStr = theme.textDim + item.duration + ansi.reset;

          lines.push(
            pointer +
              padRight(aliasStr, aliasBudget + 2) +
              " " +
              padRight(statusStr, 14) +
              " " +
              padRight(taskStr, taskBudget + 2) +
              " " +
              durStr,
          );
        }

        if (items.length > maxVisible) {
          lines.push("");
          lines.push(
            "  " +
              theme.textDim +
              (scrollOffset > 0 ? "↑ " : "  ") +
              (scrollOffset + maxVisible < items.length ? "↓ " : "  ") +
              (scrollOffset + 1) +
              "–" +
              Math.min(scrollOffset + maxVisible, items.length) +
              " of " +
              items.length +
              ansi.reset,
          );
        }

        lines.push("");
        lines.push(
          "  " +
            keyHint("↑↓", "navigate") +
            "  " +
            keyHint("Enter", "select") +
            "  " +
            keyHint("Esc", "cancel"),
        );
        lines.push("");

        const content = lines.join("\n");
        const rendered = box(
          " Subagents (" + items.length + ") ",
          content,
          dialogWidth,
        );
        const boxLines = rendered.split("\n");

        const startRow = Math.max(1, Math.floor((rows - boxLines.length) / 2));
        const startCol = Math.max(1, Math.floor((cols - dialogWidth) / 2));

        write(ansi.clear);
        for (let i = 0; i < boxLines.length; i++) {
          write(ansi.moveTo(startRow + i, startCol) + boxLines[i]!);
        }
      };

      render();

      const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (data: Buffer) => {
        const key = data.toString();

        // Escape
        if (key === "\x1b") {
          cleanup();
          resolve(null);
          return;
        }

        // Ctrl+B
        if (key === "\x02") {
          cleanup();
          resolve(null);
          return;
        }

        // Enter
        if (key === "\r") {
          cleanup();
          resolve(items[selected]!.childSessionId);
          return;
        }

        // Arrow up: \x1b[A
        if (key === "\x1b[A") {
          selected = Math.max(0, selected - 1);
          render();
          return;
        }

        // Arrow down: \x1b[B
        if (key === "\x1b[B") {
          selected = Math.min(items.length - 1, selected + 1);
          render();
          return;
        }

        // q to quit (optional convenience)
        if (key === "q") {
          cleanup();
          resolve(null);
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
}
