/**
 * Local control-plane server for OpenSlate.
 *
 * Phase 4: adds thread routes, children listing, and worker-return routes.
 */

import type { SessionId } from "@openslate/core";
import type {
  SessionService,
  ThreadService,
  EventBus,
  OpenSlateEvent,
} from "@openslate/core";

// ── Config ───────────────────────────────────────────────────────────

export interface ServerConfig {
  port: number;
  host?: string;
}

export interface ServerDeps {
  sessionService: SessionService;
  threadService: ThreadService;
  events: EventBus;
}

export interface OpenSlateServer {
  config: ServerConfig;
  readonly port: number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ── Route Helpers ────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ── Server ───────────────────────────────────────────────────────────

export function createServer(config: ServerConfig, deps: ServerDeps): OpenSlateServer {
  const { sessionService, threadService, events } = deps;
  let server: ReturnType<typeof Bun.serve> | null = null;

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // GET /health
      if (method === "GET" && path === "/health") {
        return json({ ok: true, timestamp: new Date().toISOString() });
      }

      // POST /sessions
      if (method === "POST" && path === "/sessions") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const session = sessionService.createSession({
          title: typeof body.title === "string" ? body.title : undefined,
          projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        });
        return json(session, 201);
      }

      // GET /sessions
      if (method === "GET" && path === "/sessions") {
        return json(deps.sessionService.listSessions());
      }

      // GET /sessions/:id
      const sessionMatch = path.match(/^\/sessions\/([^\/]+)$/);
      if (method === "GET" && sessionMatch) {
        const id = sessionMatch[1] as SessionId;
        const session = sessionService.getSession(id);
        if (!session) return errorResponse("Session not found", 404);
        return json(session);
      }

      // GET /sessions/:id/messages
      const messagesGetMatch = path.match(/^\/sessions\/([^\/]+)\/messages$/);
      if (method === "GET" && messagesGetMatch) {
        const sessionId = messagesGetMatch[1] as SessionId;
        const session = sessionService.getSession(sessionId);
        if (!session) return errorResponse("Session not found", 404);
        const messages = sessionService.getMessages(sessionId);
        return json(messages);
      }

      // POST /sessions/:id/messages
      const messagesPostMatch = path.match(/^\/sessions\/([^\/]+)\/messages$/);
      if (method === "POST" && messagesPostMatch) {
        const sessionId = messagesPostMatch[1] as SessionId;
        const body = await req.json() as Record<string, unknown>;
        const content = body.content;
        if (typeof content !== "string" || !content.trim()) {
          return errorResponse("Missing or empty 'content' field");
        }

        const result = await sessionService.sendMessage(sessionId, content);
        return json({
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
          usage: result.usage ?? null,
        }, 201);
      }

      // ── Thread Routes ────────────────────────────────────────────
      // POST /sessions/:id/threads — spawn or reuse a child thread
      const threadsPostMatch = path.match(/^\/sessions\/([^\/]+)\/threads$/);
      if (method === "POST" && threadsPostMatch) {
        const parentSessionId = threadsPostMatch[1] as SessionId;
        const body = await req.json() as Record<string, unknown>;
        const task = body.task;
        if (typeof task !== "string" || !task.trim()) {
          return errorResponse("Missing or empty 'task' field");
        }
        const alias = typeof body.alias === "string" ? body.alias : undefined;
        const capabilities = Array.isArray(body.capabilities) ? body.capabilities as string[] : undefined;

        const result = await threadService.spawnAndRun({
          parentSessionId,
          task,
          alias,
          capabilities,
        });

        return json({
          childSession: result.childSession,
          workerReturn: result.workerReturn,
          reused: result.reused,
        }, 201);
      }

      // GET /sessions/:id/children — list child sessions
      const childrenMatch = path.match(/^\/sessions\/([^\/]+)\/children$/);
      if (method === "GET" && childrenMatch) {
        const parentSessionId = childrenMatch[1] as SessionId;
        const children = threadService.listChildren(parentSessionId);
        return json(children);
      }

      // GET /sessions/:id/worker-returns — list worker returns for parent
      const workerReturnsMatch = path.match(/^\/sessions\/([^\/]+)\/worker-returns$/);
      if (method === "GET" && workerReturnsMatch) {
        const parentSessionId = workerReturnsMatch[1] as SessionId;
        const returns = threadService.listWorkerReturns(parentSessionId);
        return json(returns);
      }

      // GET /worker-returns/:id — get specific worker return
      const workerReturnMatch = path.match(/^\/worker-returns\/([^\/]+)$/);
      if (method === "GET" && workerReturnMatch) {
        const id = workerReturnMatch[1]!;
        const wr = threadService.getWorkerReturn(id);
        if (!wr) return errorResponse("WorkerReturn not found", 404);
        return json(wr);
      }

      // GET /events (SSE)
      if (method === "GET" && path === "/events") {
        return handleSSE(events);
      }

      return errorResponse("Not found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      console.error("[openslate] request error:", err);
      return errorResponse(message, 500);
    }
  }

  function handleSSE(events: EventBus): Response {
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        unsubscribe = events.on((event: OpenSlateEvent) => {
          try {
            controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
          } catch {
            // Stream closed
          }
        });
      },
      cancel() {
        unsubscribe?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  return {
    config,

    get port(): number | null {
      return server?.port ?? null;
    },

    async start(): Promise<void> {
      server = Bun.serve({
        port: config.port,
        hostname: config.host ?? "localhost",
        fetch: handleRequest,
      });
      config.port = server.port ?? config.port;
      console.log("[openslate] server listening on " + server.hostname + ":" + server.port);
    },

    async stop(): Promise<void> {
      if (server) {
        server.stop();
        server = null;
        console.log("[openslate] server stopped");
      }
    },
  };
}
