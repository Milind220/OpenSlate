/**
 * OpenSlate SDK client — typed HTTP client for the local control plane.
 * Phase 4: adds thread, children, and worker-return methods.
 */

import type {
  Session,
  SessionId,
  Message,
  WorkerReturn,
  ThreadRunCard,
  DelegationPlan,
} from "@openslate/core";
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
  delegationPlan: DelegationPlan | null;
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

export interface AppConfig {
  providers: Record<
    string,
    { configured: boolean; authType: "api_key" | "oauth" | "none" }
  >;
  models: {
    primary: { provider: string; model: string } | null;
    execute: { provider: string; model: string } | null;
    explore: { provider: string; model: string } | null;
    search: { provider: string; model: string } | null;
    compress: { provider: string; model: string } | null;
  };
}

// ── Client Interface ─────────────────────────────────────────────────
export interface OpenSlateClient {
  readonly config: OpenSlateClientConfig;
  health(): Promise<{ ok: boolean; timestamp: string }>;
  createSession(options?: {
    title?: string;
    projectId?: string;
  }): Promise<Session>;
  getSession(id: SessionId): Promise<Session>;
  listSessions(): Promise<Session[]>;
  getMessages(sessionId: SessionId): Promise<Message[]>;
  sendMessage(
    sessionId: SessionId,
    content: string,
  ): Promise<SendMessageResponse>;
  /** Send a message through the orchestrator (automatic delegation). */
  orchestrate(
    sessionId: SessionId,
    content: string,
  ): Promise<OrchestrateResponse>;
  /** Spawn or reuse a child thread. */
  spawnThread(
    parentSessionId: SessionId,
    options: {
      task: string;
      alias?: string;
      capabilities?: string[];
    },
  ): Promise<SpawnThreadResponse>;

  /** List child sessions for a parent. */
  listChildren(parentSessionId: SessionId): Promise<Session[]>;

  /** List worker returns for a parent. */
  listWorkerReturns(parentSessionId: SessionId): Promise<WorkerReturn[]>;

  /** Get a specific worker return. */
  getWorkerReturn(id: string): Promise<WorkerReturn>;

  /** Get app configuration. */
  getConfig(): Promise<AppConfig>;
  /** Update app configuration. */
  setConfig(config: Partial<AppConfig>): Promise<AppConfig>;
  /** Login to a provider with API key. */
  login(
    provider: string,
    apiKey: string,
  ): Promise<{ ok: boolean; provider: string }>;
  /** Get messages for a specific child session. */
  getChildMessages(
    parentSessionId: SessionId,
    childSessionId: SessionId,
  ): Promise<Message[]>;

  subscribe(signal?: AbortSignal): AsyncIterable<OpenSlateEvent>;
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

    getConfig() {
      return request("/config");
    },

    setConfig(config) {
      return request("/config", {
        method: "POST",
        body: JSON.stringify(config),
      });
    },

    login(provider, apiKey) {
      return request("/login", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      });
    },

    getChildMessages(parentSessionId, childSessionId) {
      return request(
        "/sessions/" +
          parentSessionId +
          "/children/" +
          childSessionId +
          "/messages",
      );
    },

    async *subscribe(signal?: AbortSignal): AsyncGenerator<OpenSlateEvent> {
      const res = await fetch(base + "/events", {
        headers: headers(),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new Error("Failed to connect to event stream");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const onAbort = () => {
        void reader.cancel().catch(() => {
          // best-effort cancellation
        });
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        while (true) {
          if (signal?.aborted) break;
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
        signal?.removeEventListener("abort", onAbort);
        try {
          await reader.cancel();
        } catch {
          // already closed
        }
        reader.releaseLock();
      }
    },
  };
}
