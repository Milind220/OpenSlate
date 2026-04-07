/**
 * Server bootstrap — wires core runtime, model layer, and HTTP server.
 *
 * This is the composition root for the OpenSlate local control plane.
 */

import {
  initDatabase,
  createSessionStore,
  createMessageStore,
  createEventBus,
  createSessionService,
  createModelCallAdapter,
} from "@openslate/core";
import {
  createProviderRegistry,
  createModelRouter,
  registerBuiltins,
} from "@openslate/models";
import type { ModelRouterConfig, ModelSlotConfig } from "@openslate/models";
import { createServer } from "./server.js";
import type { ServerConfig } from "./server.js";

// ── Bootstrap Config ─────────────────────────────────────────────────

export interface BootstrapConfig {
  /** Server port. Default: 7274 */
  port?: number;
  /** Server host. Default: localhost */
  host?: string;
  /** SQLite database path. Default: ~/.openslate/data.db */
  dbPath?: string;
  /** System prompt for the primary model. */
  systemPrompt?: string;
  /** Model router config override. If not provided, uses sensible defaults. */
  routerConfig?: ModelRouterConfig;
}

/**
 * Bootstrap the full OpenSlate runtime and return the server.
 */
export async function bootstrap(config: BootstrapConfig = {}) {
  const port = config.port ?? Number(process.env.OPENSLATE_PORT ?? 7274);
  const host = config.host ?? process.env.OPENSLATE_HOST ?? "localhost";

  // 1. Initialize storage
  const db = initDatabase(config.dbPath);
  const sessionStore = createSessionStore(db);
  const messageStore = createMessageStore(db);

  // 2. Initialize event bus
  const events = createEventBus();

  // 3. Initialize model layer
  const registry = createProviderRegistry();
  registerBuiltins(registry);

  // Build router config — use provided or construct from env
  const routerConfig = config.routerConfig ?? buildDefaultRouterConfig();
  const router = createModelRouter(routerConfig, registry);

  // 4. Create model call adapter
  const modelCall = createModelCallAdapter(async (input) => {
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
            totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          }
        : undefined,
    };
  });

  // 5. Create session service
  const sessionService = createSessionService({
    sessionStore,
    messageStore,
    events,
    modelCall,
    systemPrompt: config.systemPrompt ?? "You are OpenSlate, an AI assistant. Be helpful, clear, and concise.",
  });

  // 6. Create and return server
  const serverConfig: ServerConfig = { port, host };
  const server = createServer(serverConfig, { sessionService, events });

  return {
    server,
    sessionService,
    events,
    db,
  };
}

function normalizeReasoning(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeReasoning(item))
      .filter((item): item is string => Boolean(item))
      .join("\n") || undefined;
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

// ── Default Router Config ────────────────────────────────────────────

function buildDefaultRouterConfig(): ModelRouterConfig {
  const explicitProvider = process.env.OPENSLATE_PRIMARY_PROVIDER;
  const explicitModel = process.env.OPENSLATE_PRIMARY_MODEL;

  if (explicitProvider && explicitModel) {
    const primary = {
      provider: explicitProvider as any,
      model: explicitModel as any,
    };

    return {
      primary,
      execute: primary,
      explore: primary,
      search: primary,
      compress: primary,
    };
  }

  // Check which provider is available via env vars
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasFireworks = !!process.env.FIREWORKS_API_KEY;

  let primary: ModelSlotConfig;

  if (hasAnthropic) {
    primary = {
      provider: "anthropic" as any,
      model: "claude-sonnet-4-20250514" as any,
    };
  } else if (hasOpenAI) {
    primary = {
      provider: "openai" as any,
      model: "gpt-4o" as any,
    };
  } else if (hasFireworks) {
    primary = {
      provider: "fireworks" as any,
      model: "accounts/fireworks/models/deepseek-v3" as any,
    };
  } else {
    throw new Error(
      "No model provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or FIREWORKS_API_KEY, or set OPENSLATE_PRIMARY_PROVIDER and OPENSLATE_PRIMARY_MODEL explicitly."
    );
  }

  // For Phase 3, all slots use the primary model
  return {
    primary,
    execute: primary,
    explore: primary,
    search: primary,
    compress: primary,
  };
}
