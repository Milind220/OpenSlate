/**
 * OpenSlate SDK client types.
 *
 * Typed client interface for the local control-plane API.
 * Placeholder — real client implementation comes in a later phase.
 */

import type { Session, SessionId, Message } from "@openslate/core";

export interface OpenSlateClientConfig {
  baseUrl: string;
  /** Optional auth token for the local server. */
  token?: string;
}

/**
 * Client interface for the OpenSlate control plane.
 * Methods match the future API route families.
 */
export interface OpenSlateClient {
  readonly config: OpenSlateClientConfig;

  /** Health check. */
  health(): Promise<{ ok: boolean }>;

  /** List sessions. */
  listSessions(): Promise<Session[]>;

  /** Get a single session. */
  getSession(id: SessionId): Promise<Session>;

  /** Send a message to a session. */
  sendMessage(sessionId: SessionId, content: string): Promise<Message>;
}
