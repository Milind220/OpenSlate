/**
 * OpenSlate SDK client — typed HTTP client for the local control plane.
 * Phase 4: adds thread, children, and worker-return methods.
 */

import type { Session, SessionId, Message, WorkerReturn, ThreadRunCard } from "@openslate/core";
import type { OpenSlateEvent } from "@openslate/core";

// ── Config ───────────────────────────────────────────────────────────

export interface OpenSlateClientConfig {
  baseUrl: string;
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

export interface OrchestrateResponse {
  userMessage: Message;
  assistantMessage: Message;
  threadRuns: ThreadRunCard[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

export interface SpawnThreadResponse {
  childSession: Session;
  workerReturn: WorkerReturn;
  reused: boolean;
}
// ── Client Interface ─────────────────────────────────────────────────

export interface OpenSlateClient {
  readonly config: OpenSlateClientConfig;

  health(): Promise<{ ok: boolean; timestamp: string }>;
  createSession(options?: { title?: string; projectId?: string }): Promise<Session>;
  getSession(id: SessionId): Promise<Session>;
  listSessions(): Promise<Session[]>;
  getMessages(sessionId: SessionId): Promise<Message[]>;
  sendMessage(sessionId: SessionId, content: string): Promise<SendMessageResponse>;
  /** Send a message through the orchestrator (automatic delegation). */
  orchestrate(sessionId: SessionId, content: string): Promise<OrchestrateResponse>;
  /** Spawn or reuse a child thread. */
  spawnThread(parentSessionId: SessionId, options: {
    task: string;
    alias?: string;
    capabilities?: string[];
  }): Promise<SpawnThreadResponse>;

  /** List child sessions for a parent. */
  listChildren(parentSessionId: SessionId): Promise<Session[]>;

  /** List worker returns for a parent. */
  listWorkerReturns(parentSessionId: SessionId): Promise<WorkerReturn[]>;

  /** Get a specific worker return. */
  getWorkerReturn(id: string): Promise<WorkerReturn>;

  subscribe(): AsyncIterable<OpenSlateEvent>;
}

// ── Implementation ───────────────────────────────────────────────────

export function createClient(config: OpenSlateClientConfig): OpenSlateClient {
  const base = config.baseUrl.replace(/\/$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.token) h["Authorization"] = "Bearer " + config.token;
    return h;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...headers(), ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error("HTTP " + res.status + ": " + body);
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
      return request("/sessions/" + id);
    },

    listSessions() {
      return request("/sessions");
    },

    getMessages(sessionId) {
      return request("/sessions/" + sessionId + "/messages");
    },
    sendMessage(sessionId, content) {
      return request("/sessions/" + sessionId + "/messages", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    },

    orchestrate(sessionId, content) {
      return request("/sessions/" + sessionId + "/orchestrate", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    },

    spawnThread(parentSessionId, options) {
      return request("/sessions/" + parentSessionId + "/threads", {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    listChildren(parentSessionId) {
      return request("/sessions/" + parentSessionId + "/children");
    },

    listWorkerReturns(parentSessionId) {
      return request("/sessions/" + parentSessionId + "/worker-returns");
    },

    getWorkerReturn(id) {
      return request("/worker-returns/" + id);
    },

    async *subscribe(): AsyncGenerator<OpenSlateEvent> {
      const res = await fetch(base + "/events", { headers: headers() });
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
