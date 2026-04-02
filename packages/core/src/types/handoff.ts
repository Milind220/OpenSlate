/**
 * HandoffState — the mutable rolling checkpoint object per session.
 *
 * This is a first-class runtime primitive. Each session owns exactly one.
 * It tracks compaction progress and compressed summary state.
 *
 * Two-stage compaction:
 *   marker  — a lightweight checkpoint indicating compaction should happen
 *   rolling — full writeback with compressed summary
 */

import type { SessionId } from "./session.js";

export type HandoffKind = "marker" | "rolling_state";

export interface HandoffState {
  id: string;
  sessionId: SessionId;
  kind: HandoffKind;
  /** Compressed summary of the session up to lastCompressionIndex. */
  compressedSummary: string | null;
  /** Message index up to which compaction has been applied. */
  lastCompressionIndex: number;
  /** Prompt token count at time of last compression. */
  lastPromptTokens: number;
  /** Whether the marker-stage has been completed. */
  markerCompleted: boolean;
  updatedAt: string;
}
