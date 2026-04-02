/**
 * Artifact — a persisted output from tool execution or session work.
 */

import type { SessionId, ArtifactId } from "./session.js";

export type ArtifactKind = "file" | "diff" | "snapshot" | "tool_output" | "blob";

export interface Artifact {
  id: ArtifactId;
  sessionId: SessionId;
  kind: ArtifactKind;
  title: string;
  mimeType: string | null;
  /** Reference to blob storage path if content is external. */
  blobRef: string | null;
  /** Inline content for small artifacts. */
  content: string | null;
  createdAt: string;
}
