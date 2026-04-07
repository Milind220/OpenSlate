/**
 * Runtime event bus for OpenSlate.
 *
 * Simple typed EventEmitter for session/message lifecycle events.
 * Later phases will extend this with thread, reintegration, and compaction events.
 */

// ── Event Types ──────────────────────────────────────────────────────

export interface RuntimeEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SessionCreatedEvent extends RuntimeEvent {
  type: "session.created";
  payload: { sessionId: string };
}

export interface SessionUpdatedEvent extends RuntimeEvent {
  type: "session.updated";
  payload: { sessionId: string; field: string };
}

export interface MessageCreatedEvent extends RuntimeEvent {
  type: "message.created";
  payload: { sessionId: string; messageId: string; role: string };
}

export interface AssistantStartedEvent extends RuntimeEvent {
  type: "assistant.started";
  payload: { sessionId: string };
}

export interface AssistantCompletedEvent extends RuntimeEvent {
  type: "assistant.completed";
  payload: { sessionId: string; messageId: string };
}

export interface AssistantFailedEvent extends RuntimeEvent {
  type: "assistant.failed";
  payload: { sessionId: string; messageId: string; error: string };
}

export type OpenSlateEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | MessageCreatedEvent
  | AssistantStartedEvent
  | AssistantCompletedEvent
  | AssistantFailedEvent;

export type OpenSlateEventType = OpenSlateEvent["type"];

// ── Event Bus ────────────────────────────────────────────────────────

export type EventListener = (event: OpenSlateEvent) => void;

export interface EventBus {
  on(listener: EventListener): () => void;
  emit(event: OpenSlateEvent): void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();

  return {
    on(listener: EventListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    emit(event: OpenSlateEvent): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error("[openslate] event listener error:", err);
        }
      }
    },
  };
}

function makeEvent<T extends OpenSlateEvent>(type: T["type"], payload: T["payload"]): T {
  return { type, timestamp: new Date().toISOString(), payload } as T;
}

export const RuntimeEvents = {
  sessionCreated(sessionId: string): SessionCreatedEvent {
    return makeEvent<SessionCreatedEvent>("session.created", { sessionId });
  },
  sessionUpdated(sessionId: string, field: string): SessionUpdatedEvent {
    return makeEvent<SessionUpdatedEvent>("session.updated", { sessionId, field });
  },
  messageCreated(sessionId: string, messageId: string, role: string): MessageCreatedEvent {
    return makeEvent<MessageCreatedEvent>("message.created", { sessionId, messageId, role });
  },
  assistantStarted(sessionId: string): AssistantStartedEvent {
    return makeEvent<AssistantStartedEvent>("assistant.started", { sessionId });
  },
  assistantCompleted(sessionId: string, messageId: string): AssistantCompletedEvent {
    return makeEvent<AssistantCompletedEvent>("assistant.completed", { sessionId, messageId });
  },
  assistantFailed(sessionId: string, messageId: string, error: string): AssistantFailedEvent {
    return makeEvent<AssistantFailedEvent>("assistant.failed", { sessionId, messageId, error });
  },
};
