/**
 * Inspector panel renderer.
 *
 * Produces formatted ANSI lines for parent session details,
 * child sessions, and worker returns.
 */

import type { OpenSlateClient } from "@openslate/sdk";
import type { Session, SessionId, WorkerReturn } from "@openslate/core";
import { ansi, theme, writeln, write, horizontalRule, statusBadge, padRight, truncate, box } from "../renderer.js";

export class InspectorPanel {
  private client: OpenSlateClient;
  private sessionId: SessionId;

  constructor(client: OpenSlateClient, sessionId: SessionId) {
    this.client = client;
    this.sessionId = sessionId;
  }

  async renderToLines(): Promise<string[]> {
    try {
      const [session, children, workerReturns] = await Promise.all([
        this.client.getSession(this.sessionId),
        this.client.listChildren(this.sessionId),
        this.client.listWorkerReturns(this.sessionId),
      ]);

      const lines: string[] = [];
      lines.push(theme.accentBold + "Inspector" + ansi.reset);
      lines.push(horizontalRule(76));
      lines.push("");

      lines.push(...this.renderParent(session));
      lines.push("");
      lines.push(...this.renderChildren(children, workerReturns));
      lines.push("");
      lines.push(...this.renderWorkerReturns(workerReturns));

      return box(" inspector ", lines.join("\n"), 78).split("\n");
    } catch (e: any) {
      return box(
        " inspector ",
        [
          theme.error + "Failed to render inspector" + ansi.reset,
          theme.textDim + String(e?.message || e) + ansi.reset,
        ].join("\n"),
        78,
      ).split("\n");
    }
  }

  private renderParent(session: Session): string[] {
    return [
      theme.text + "Parent Session" + ansi.reset,
      "  " + theme.textDim + "id: " + ansi.reset + theme.sessionId + session.id + ansi.reset,
      "  " + theme.textDim + "status: " + ansi.reset + statusBadge(session.status),
      "  " + theme.textDim + "title: " + ansi.reset + theme.text + (session.title || "Untitled") + ansi.reset,
    ];
  }

  private renderChildren(children: Session[], workerReturns: WorkerReturn[]): string[] {
    const lines: string[] = [theme.text + "Child Sessions" + ansi.reset];

    if (children.length === 0) {
      lines.push("  " + theme.textDim + "none" + ansi.reset);
      return lines;
    }

    const returnCountByChild = new Map<SessionId, number>();
    for (const ret of workerReturns) {
      returnCountByChild.set(ret.childSessionId, (returnCountByChild.get(ret.childSessionId) || 0) + 1);
    }

    for (const child of children) {
      const alias = child.alias
        ? theme.alias + child.alias + ansi.reset
        : theme.textDim + "(no alias)" + ansi.reset;

      const reused = (returnCountByChild.get(child.id) || 0) > 1;
      const reusedBadge = reused ? " " + theme.warning + "[reused]" + ansi.reset : "";

      const line =
        "  - "
        + padRight(alias, 18)
        + " "
        + theme.sessionId + child.id.slice(0, 12) + ansi.reset
        + " "
        + statusBadge(child.status)
        + reusedBadge;

      lines.push(truncate(line, 72));
    }

    return lines;
  }

  private renderWorkerReturns(workerReturns: WorkerReturn[]): string[] {
    const lines: string[] = [theme.text + "Worker Returns" + ansi.reset];

    if (workerReturns.length === 0) {
      lines.push("  " + theme.textDim + "none" + ansi.reset);
      return lines;
    }

    const sorted = [...workerReturns].sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    for (const ret of sorted) {
      const output = (ret.output || "").replace(/\s+/g, " ").trim();
      const preview = output.length > 0 ? output : "(no output)";
      const line =
        "  - "
        + padRight(theme.sessionId + ret.id.slice(0, 10) + ansi.reset, 14)
        + " "
        + statusBadge(ret.status)
        + " "
        + theme.textDim + truncate(preview, 36) + ansi.reset;

      lines.push(truncate(line, 72));
    }

    return lines;
  }
}
