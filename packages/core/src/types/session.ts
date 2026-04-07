/**
 * Core session types for OpenSlate runtime.
 *
 * Sessions form a graph: parent sessions can spawn child ThreadSessions
 * and QuerySessions. Each session owns one mutable HandoffState.
 *
 * These types are provider-agnostic — no model/provider specifics leak here.
 */

// ── Identifiers ──────────────────────────────────────────────────────

export type SessionId = string & { readonly __brand: "SessionId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type ArtifactId = string & { readonly __brand: "ArtifactId" };

// ── Session ──────────────────────────────────────────────────────────

export type SessionKind = "primary" | "thread" | "query";
export type SessionStatus = "active" | "paused" | "completed" | "aborted" | "failed" | "blocked";

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  kind: SessionKind;
  status: SessionStatus;
  parentId: SessionId | null;
  alias: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ThreadSession — a tactical child session with tool access.
 * Alias-backed: reusing the same alias reuses the same child session.
 */
export interface ThreadSession extends Session {
  kind: "thread";
  parentId: SessionId;
  alias: string;
  capabilities: string[];
  task: string;
}

/**
 * QuerySession — a lightweight child session for research/synthesis.
 * Typically no or limited tool access.
 */
export interface QuerySession extends Session {
  kind: "query";
  parentId: SessionId;
  task: string;
}
