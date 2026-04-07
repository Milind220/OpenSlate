/**
 * OpenSlate SDK client — typed HTTP client for the local control plane.
 */

import type { Session, SessionId, Message } from "@openslate/core";
import type { OpenSlateEvent } from "@openslate/core";

// ── Config ───────────────────────────────────────────────────────────

export interface OpenSlateClientConfig {
  baseUrl: string;
  /** Optional auth token for the local server. */
  token?: string;
}

// ── Response Types ───────────────────────────────────────────────────

export interface SendMessageResponse {
  userMessage: Message;
  assistantMessage: Message;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

// ── Client Interface ─────────────────────────────────────────────────

export interface OpenSlateClient {
  readonly config: OpenSlateClientConfig;

  /** Health check. */
  health(): Promise<{ ok: boolean; timestamp: string }>;

  /** Create a new session. */
  createSession(options?: { title?: string; projectId?: string }): Promise<Session>;

  /** Get a single session. */
  getSession(id: SessionId): Promise<Session>;

  /** Get messages for a session. */
  getMessages(sessionId: SessionId): Promise<Message[]>;

  /** Send a message and get the assistant response. */
  sendMessage(sessionId: SessionId, content: string): Promise<SendMessageResponse>;

  /** Subscribe to SSE event stream. Returns an async iterable. */
  subscribe(): AsyncIterable<OpenSlateEvent>;
}

// ── Implementation ───────────────────────────────────────────────────

export function createClient(config: OpenSlateClientConfig): OpenSlateClient {
  const base = config.baseUrl.replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.token) h["Authorization"] = `Bearer ${config.token}`;
    return h;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers(), ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    config,

    health() {
      return request("/health");
    },

    createSession(options) {
      return request("/sessions", {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      });
    },

    getSession(id) {
      return request(`/sessions/${id}`);
    },

    getMessages(sessionId) {
      return request(`/sessions/${sessionId}/messages`);
    },

    sendMessage(sessionId, content) {
      return request(`/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    },

    async *subscribe(): AsyncGenerator<OpenSlateEvent> {
      const res = await fetch(`${base}/events`, {
        headers: headers(),
      });
      if (!res.ok || !res.body) {
        throw new Error("Failed to connect to event stream");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as OpenSlateEvent;
                yield event;
              } catch {
                // Skip malformed events
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
