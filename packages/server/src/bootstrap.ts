/**
 * Server bootstrap — wires core runtime, model layer, and HTTP server.
 *
 * Phase 4: adds thread service, tool registry, and child model adapter.
 */

import {
  initDatabase,
  createSessionStore,
  createMessageStore,
  createWorkerReturnStore,
  createEpisodeStore,
  createEventBus,
  createSessionService,
  createModelCallAdapter,
  createChildModelCallAdapter,
  createThreadService,
  createOrchestratorService,
} from "@openslate/core";
import type { ChildToolCall } from "@openslate/core";
import { createProviderRegistry } from "@openslate/models";
import type { ModelRouterConfig } from "@openslate/models";
import {
  createRuntimeConfigService,
  estimateCostUsd,
  getModelLabel,
} from "./runtime-config-service.js";
import { createToolRegistry, registerBuiltinTools } from "@openslate/tools";
import type { ToolCapability } from "@openslate/tools";
import { createServer } from "./server.js";
import type { ServerConfig } from "./server.js";
// ── Bootstrap Config ─────────────────────────────────────────────────

export interface BootstrapConfig {
  port?: number;
  host?: string;
  dbPath?: string;
  systemPrompt?: string;
  routerConfig?: ModelRouterConfig;
}

export async function bootstrap(config: BootstrapConfig = {}) {
  const port = config.port ?? Number(process.env.OPENSLATE_PORT ?? 7274);
  const host = config.host ?? process.env.OPENSLATE_HOST ?? "localhost";

  // 1. Initialize storage
  const db = initDatabase(config.dbPath);
  const sessionStore = createSessionStore(db);
  const messageStore = createMessageStore(db);
  const workerReturnStore = createWorkerReturnStore(db);
  const episodeStore = createEpisodeStore(db);
  // 2. Initialize event bus
  const events = createEventBus();

  // 3. Initialize model layer + persisted config/auth
  const registry = createProviderRegistry();
  const runtimeConfig = createRuntimeConfigService(
    db,
    registry,
    config.routerConfig,
  );

  // 4. Initialize tool registry
  const toolRegistry = createToolRegistry();
  registerBuiltinTools(toolRegistry);
  // 5. Create parent model call adapter (chat mode, no tools)
  const modelCall = createModelCallAdapter(async (input) => {
    const router = runtimeConfig.getRouter();
    const result = await router.complete("primary", {
      messages: input.messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      system: input.system,
    });

    return {
      text: result.text,
      reasoning: normalizeReasoning((result as any).reasoning),
      usage: result.usage
        ? {
            promptTokens: result.usage.inputTokens ?? 0,
            completionTokens: result.usage.outputTokens ?? 0,
            totalTokens:
              (result.usage.inputTokens ?? 0) +
              (result.usage.outputTokens ?? 0),
          }
        : undefined,
    };
  });
  // 6. Create child model call adapter (tool-calling mode)
  const childModelCall = createChildModelCallAdapter(async (input) => {
    // Build AI SDK tool definitions from our tool format
    const aiTools: Record<string, any> = {};
    if (input.tools) {
      const { tool: aiTool, jsonSchema: aiJsonSchema } = await import("ai");
      for (const [name, def] of Object.entries(input.tools)) {
        aiTools[name] = aiTool({
          description: def.description,
          inputSchema: aiJsonSchema(def.parameters as any),
        });
      }
    }

    // Build messages for AI SDK
    const messages = buildAIMessages(input.messages);

    const router = runtimeConfig.getRouter();
    const result = await router.complete("execute", {
      messages,
      system: input.system,
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
    });

    const usage = result.usage
      ? {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
          totalTokens:
            (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
        }
      : undefined;

    return {
      text: result.text ?? "",
      toolCalls: normalizeRouterToolCalls(result.toolCalls ?? []),
      finishReason: result.finishReason ?? "stop",
      usage,
      model: await getModelLabel(router, "execute"),
      estimatedCostUsd: await estimateCostUsd(router, "execute", usage),
    };
  });
  // 7. Create session service (parent)
  const sessionService = createSessionService({
    sessionStore,
    messageStore,
    events,
    modelCall,
    systemPrompt:
      config.systemPrompt ??
      "You are OpenSlate, an AI assistant. Be helpful, clear, and concise.",
  });

  // 8. Create thread service
  const threadService = createThreadService({
    sessionStore,
    messageStore,
    workerReturnStore,
    episodeStore,
    events,
    childModelCall,
    createToolExecutor: (capabilities: string[]) => {
      return async (call: ChildToolCall) => {
        const result = await toolRegistry.execute(
          { id: call.id, name: call.name, args: call.args },
          capabilities as ToolCapability[],
        );
        return {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.content,
          isError: result.isError,
        };
      };
    },
    getToolSet: (capabilities: string[]) => {
      return toolRegistry.getToolSet(capabilities as ToolCapability[]);
    },
  });

  // 8.5. Create orchestrator service
  const orchestratorService = createOrchestratorService({
    sessionStore,
    messageStore,
    events,
    modelCall,
    threadService,
    systemPrompt: config.systemPrompt,
  });

  // 9. Create and return server
  const serverConfig: ServerConfig = { port, host };
  const server = createServer(serverConfig, {
    sessionService,
    threadService,
    orchestratorService,
    events,
    configService: runtimeConfig,
  });
  return {
    server,
    sessionService,
    threadService,
    orchestratorService,
    events,
    toolRegistry,
    episodeStore,
    db,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeReasoning(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return (
      value
        .map((item) => normalizeReasoning(item))
        .filter((item): item is string => Boolean(item))
        .join("\n") || undefined
    );
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Build AI SDK compatible messages from our internal format.
 */
export function normalizeRouterToolCalls(
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    input?: unknown;
  }>,
): Array<{
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}> {
  return toolCalls.map((tc) => ({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    args: asRecord(tc.args) ?? asRecord(tc.input) ?? {},
  }));
}

export function buildAIMessages(
  messages: Array<{
    role: string;
    content: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    toolCalls?: ChildToolCall[];
  }>,
): any[] {
  const toolCallInputs = new Map<
    string,
    { toolName: string; input: Record<string, unknown> }
  >();

  return messages.map((msg) => {
    if (msg.role === "tool") {
      const priorCall = msg.toolCallId
        ? toolCallInputs.get(msg.toolCallId)
        : undefined;
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: msg.toolCallId,
            toolName: msg.toolName ?? priorCall?.toolName ?? "unknown_tool",
            input: priorCall?.input ?? {},
            output: msg.isError
              ? { type: "error-text", value: msg.content }
              : { type: "text", value: msg.content },
          },
        ],
      };
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        toolCallInputs.set(tc.id, { toolName: tc.name, input: tc.args });
      }

      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text", text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.args,
          })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
