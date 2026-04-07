/**
 * SessionService — the core single-session runtime seam.
 *
 * Coordinates session creation, message persistence, model calls,
 * and event emission. Provider-agnostic and server-agnostic.
 *
 * This is the first real runtime service in OpenSlate.
 */

import type { Session, SessionId, MessagePart, Message } from "./types/index.js";
import type { SessionStore, CreateSessionInput } from "./storage/session-store.js";
import type { MessageStore } from "./storage/message-store.js";
import type { EventBus } from "./events.js";
import { RuntimeEvents } from "./events.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Model call function signature.
 * This is the seam between the runtime and the model layer.
 * The session service doesn't know about ModelRouter directly —
 * it receives a function that takes messages and returns assistant parts.
 */
export interface ModelCallInput {
  messages: Array<{ role: string; content: string }>;
  system?: string;
}

export interface ModelCallResult {
  parts: MessagePart[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type ModelCallFn = (input: ModelCallInput) => Promise<ModelCallResult>;

export interface SendMessageResult {
  userMessage: Message;
  assistantMessage: Message;
  usage?: ModelCallResult["usage"];
}

// ── Service Interface ────────────────────────────────────────────────

export interface SessionService {
  createSession(input?: CreateSessionInput): Session;
  getSession(id: SessionId): Session | null;
  listSessions(): Session[];
  getMessages(sessionId: SessionId): Message[];
  sendMessage(sessionId: SessionId, content: string): Promise<SendMessageResult>;
}

// ── Implementation ───────────────────────────────────────────────────

export interface SessionServiceDeps {
  sessionStore: SessionStore;
  messageStore: MessageStore;
  events: EventBus;
  modelCall: ModelCallFn;
  systemPrompt?: string;
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { sessionStore, messageStore, events, modelCall, systemPrompt } = deps;

  return {
    createSession(input?: CreateSessionInput): Session {
      const session = sessionStore.create(input ?? {});
      events.emit(RuntimeEvents.sessionCreated(session.id));
      return session;
    },

    getSession(id: SessionId): Session | null {
      return sessionStore.get(id);
    },

    listSessions(): Session[] {
      return sessionStore.list();
    },

    getMessages(sessionId: SessionId): Message[] {
      return messageStore.listBySession(sessionId);
    },

    async sendMessage(sessionId: SessionId, content: string): Promise<SendMessageResult> {
      // 1. Validate session exists
      const session = sessionStore.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // 2. Persist user message
      const userMessage = messageStore.append({
        sessionId,
        role: "user",
        parts: [{ kind: "text", content }],
      });
      events.emit(RuntimeEvents.messageCreated(sessionId, userMessage.id, "user"));

      // 3. Load full transcript
      const history = messageStore.listBySession(sessionId);

      // 4. Build model input from structured transcript
      const modelMessages = history.map((msg) => ({
        role: msg.role,
        content: msg.parts
          .filter((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text")
          .map((p) => p.content)
          .join("\n"),
      }));

      // 5. Call model
      events.emit(RuntimeEvents.assistantStarted(sessionId));

      try {
        const result = await modelCall({
          messages: modelMessages,
          system: systemPrompt,
        });

        // 6. Persist assistant message with structured parts
        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: result.parts,
        });
        events.emit(RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"));
        events.emit(RuntimeEvents.assistantCompleted(sessionId, assistantMessage.id));

        // 7. Update session timestamp
        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));

        return {
          userMessage,
          assistantMessage,
          usage: result.usage,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Model call failed";
        const assistantMessage = messageStore.append({
          sessionId,
          role: "assistant",
          parts: [{ kind: "status", content: `error: ${message}` }],
        });
        events.emit(RuntimeEvents.messageCreated(sessionId, assistantMessage.id, "assistant"));
        events.emit(RuntimeEvents.assistantFailed(sessionId, assistantMessage.id, message));
        sessionStore.touch(sessionId);
        events.emit(RuntimeEvents.sessionUpdated(sessionId, "updatedAt"));
        throw error;
      }
    },
  };
}
