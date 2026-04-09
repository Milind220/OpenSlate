/**
 * Runtime event bus for OpenSlate.
 *
 * Typed EventEmitter for session, message, thread, and worker-return lifecycle events.
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

// ── Thread Events ────────────────────────────────────────────────────

export interface ThreadCreatedEvent extends RuntimeEvent {
  type: "thread.created";
  payload: {
    parentSessionId: string;
    childSessionId: string;
    alias: string | null;
    task: string;
  };
}

export interface ThreadReusedEvent extends RuntimeEvent {
  type: "thread.reused";
  payload: {
    parentSessionId: string;
    childSessionId: string;
    alias: string;
    task: string;
  };
}

export interface ThreadStartedEvent extends RuntimeEvent {
  type: "thread.started";
  payload: { childSessionId: string; task: string };
}

export interface ThreadCompletedEvent extends RuntimeEvent {
  type: "thread.completed";
  payload: { childSessionId: string; workerReturnId: string };
}

export interface ThreadFailedEvent extends RuntimeEvent {
  type: "thread.failed";
  payload: { childSessionId: string; error: string };
}

export interface ThreadToolStartedEvent extends RuntimeEvent {
  type: "thread.tool_started";
  payload: { childSessionId: string; toolName: string; toolCallId: string };
}

export interface ThreadToolCompletedEvent extends RuntimeEvent {
  type: "thread.tool_completed";
  payload: {
    childSessionId: string;
    toolName: string;
    toolCallId: string;
    isError: boolean;
  };
}

export interface ThreadActivityEvent extends RuntimeEvent {
  type: "thread.activity";
  payload: { childSessionId: string; activity: string };
}

export interface WorkerReturnCreatedEvent extends RuntimeEvent {
  type: "worker_return.created";
  payload: {
    workerReturnId: string;
    parentSessionId: string;
    childSessionId: string;
    status: string;
  };
}

export interface EpisodeCreatedEvent extends RuntimeEvent {
  type: "episode.created";
  payload: {
    episodeId: string;
    workerReturnId: string;
    parentSessionId: string;
    childSessionId: string;
    status: string;
  };
}
// ── Union ────────────────────────────────────────────────────────────

export type OpenSlateEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | MessageCreatedEvent
  | AssistantStartedEvent
  | AssistantCompletedEvent
  | AssistantFailedEvent
  | ThreadCreatedEvent
  | ThreadReusedEvent
  | ThreadStartedEvent
  | ThreadCompletedEvent
  | ThreadFailedEvent
  | ThreadToolStartedEvent
  | ThreadToolCompletedEvent
  | ThreadActivityEvent
  | WorkerReturnCreatedEvent
  | EpisodeCreatedEvent;
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
      return () => {
        listeners.delete(listener);
      };
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

function makeEvent<T extends OpenSlateEvent>(
  type: T["type"],
  payload: T["payload"],
): T {
  return { type, timestamp: new Date().toISOString(), payload } as T;
}

export const RuntimeEvents = {
  // Session events
  sessionCreated(sessionId: string): SessionCreatedEvent {
    return makeEvent<SessionCreatedEvent>("session.created", { sessionId });
  },
  sessionUpdated(sessionId: string, field: string): SessionUpdatedEvent {
    return makeEvent<SessionUpdatedEvent>("session.updated", {
      sessionId,
      field,
    });
  },
  messageCreated(
    sessionId: string,
    messageId: string,
    role: string,
  ): MessageCreatedEvent {
    return makeEvent<MessageCreatedEvent>("message.created", {
      sessionId,
      messageId,
      role,
    });
  },
  assistantStarted(sessionId: string): AssistantStartedEvent {
    return makeEvent<AssistantStartedEvent>("assistant.started", { sessionId });
  },
  assistantCompleted(
    sessionId: string,
    messageId: string,
  ): AssistantCompletedEvent {
    return makeEvent<AssistantCompletedEvent>("assistant.completed", {
      sessionId,
      messageId,
    });
  },
  assistantFailed(
    sessionId: string,
    messageId: string,
    error: string,
  ): AssistantFailedEvent {
    return makeEvent<AssistantFailedEvent>("assistant.failed", {
      sessionId,
      messageId,
      error,
    });
  },

  // Thread events
  threadCreated(
    parentSessionId: string,
    childSessionId: string,
    alias: string | null,
    task: string,
  ): ThreadCreatedEvent {
    return makeEvent<ThreadCreatedEvent>("thread.created", {
      parentSessionId,
      childSessionId,
      alias,
      task,
    });
  },
  threadReused(
    parentSessionId: string,
    childSessionId: string,
    alias: string,
    task: string,
  ): ThreadReusedEvent {
    return makeEvent<ThreadReusedEvent>("thread.reused", {
      parentSessionId,
      childSessionId,
      alias,
      task,
    });
  },
  threadStarted(childSessionId: string, task: string): ThreadStartedEvent {
    return makeEvent<ThreadStartedEvent>("thread.started", {
      childSessionId,
      task,
    });
  },
  threadCompleted(
    childSessionId: string,
    workerReturnId: string,
  ): ThreadCompletedEvent {
    return makeEvent<ThreadCompletedEvent>("thread.completed", {
      childSessionId,
      workerReturnId,
    });
  },
  threadFailed(childSessionId: string, error: string): ThreadFailedEvent {
    return makeEvent<ThreadFailedEvent>("thread.failed", {
      childSessionId,
      error,
    });
  },
  threadToolStarted(
    childSessionId: string,
    toolName: string,
    toolCallId: string,
  ): ThreadToolStartedEvent {
    return makeEvent<ThreadToolStartedEvent>("thread.tool_started", {
      childSessionId,
      toolName,
      toolCallId,
    });
  },
  threadToolCompleted(
    childSessionId: string,
    toolName: string,
    toolCallId: string,
    isError: boolean,
  ): ThreadToolCompletedEvent {
    return makeEvent<ThreadToolCompletedEvent>("thread.tool_completed", {
      childSessionId,
      toolName,
      toolCallId,
      isError,
    });
  },
  threadActivity(
    childSessionId: string,
    activity: string,
  ): ThreadActivityEvent {
    return makeEvent<ThreadActivityEvent>("thread.activity", {
      childSessionId,
      activity,
    });
  },
  workerReturnCreated(
    workerReturnId: string,
    parentSessionId: string,
    childSessionId: string,
    status: string,
  ): WorkerReturnCreatedEvent {
    return makeEvent<WorkerReturnCreatedEvent>("worker_return.created", {
      workerReturnId,
      parentSessionId,
      childSessionId,
      status,
    });
  },
  episodeCreated(
    episodeId: string,
    workerReturnId: string,
    parentSessionId: string,
    childSessionId: string,
    status: string,
  ): EpisodeCreatedEvent {
    return makeEvent<EpisodeCreatedEvent>("episode.created", {
      episodeId,
      workerReturnId,
      parentSessionId,
      childSessionId,
      status,
    });
  },
};