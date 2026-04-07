/**
 * Built-in model definitions for OpenSlate.
 *
 * Users just set API keys (OPENAI_API_KEY, FIREWORKS_API_KEY) and these
 * models are available out of the box. No manual configuration needed.
 *
 * Priority providers:
 * - OpenAI (direct): gpt-4o, gpt-4o-mini, o3, o3-mini, o4-mini
 * - Fireworks (via openai-compatible): DeepSeek, Llama, etc.
 */

import type {
  ProviderConfig,
  ModelInfo,
  ModelCapabilities,
  ModelCost,
  ModelLimits,
  ProviderId,
  ModelId,
} from "./types.js";
import { makeProviderId, makeModelId } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function caps(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolCall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    ...overrides,
  };
}

function cost(input: number, output: number, cacheRead = 0, cacheWrite = 0): ModelCost {
  return { input, output, cache: { read: cacheRead, write: cacheWrite } };
}

function limits(context: number, output: number): ModelLimits {
  return { context, output };
}

function model(
  id: string,
  providerId: string,
  name: string,
  opts: {
    apiId?: string;
    npm: string;
    family?: string;
    status?: ModelInfo["status"];
    capabilities?: Partial<ModelCapabilities>;
    cost?: ModelCost;
    limits?: ModelLimits;
    apiUrl?: string;
  },
): ModelInfo {
  return {
    id: makeModelId(id),
    providerId: makeProviderId(providerId),
    name,
    family: opts.family,
    apiId: opts.apiId ?? id,
    npm: opts.npm,
    apiUrl: opts.apiUrl,
    status: opts.status ?? "active",
    capabilities: caps(opts.capabilities),
    cost: opts.cost ?? cost(0, 0),
    limits: opts.limits ?? limits(128_000, 4_096),
  };
}

// ── OpenAI Models ────────────────────────────────────────────────────

const OPENAI_NPM = "@ai-sdk/openai";

export const OPENAI_MODELS: Record<string, ModelInfo> = {
  "gpt-4o": model("gpt-4o", "openai", "GPT-4o", {
    npm: OPENAI_NPM,
    family: "gpt-4o",
    capabilities: {
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(2.5, 10, 1.25, 1.25),
    limits: limits(128_000, 16_384),
  }),

  "gpt-4o-mini": model("gpt-4o-mini", "openai", "GPT-4o Mini", {
    npm: OPENAI_NPM,
    family: "gpt-4o",
    capabilities: {
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(0.15, 0.6, 0.075, 0.075),
    limits: limits(128_000, 16_384),
  }),

  "o3": model("o3", "openai", "o3", {
    npm: OPENAI_NPM,
    family: "o3",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(2, 8, 0.5, 0.5),
    limits: limits(200_000, 100_000),
  }),

  "o3-mini": model("o3-mini", "openai", "o3 Mini", {
    npm: OPENAI_NPM,
    family: "o3",
    capabilities: {
      temperature: false,
      reasoning: true,
    },
    cost: cost(1.1, 4.4, 0.55, 0.55),
    limits: limits(200_000, 100_000),
  }),

  "o4-mini": model("o4-mini", "openai", "o4 Mini", {
    npm: OPENAI_NPM,
    family: "o4",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      toolCall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(1.1, 4.4, 0.275, 0.275),
    limits: limits(200_000, 100_000),
  }),

  "gpt-4.1": model("gpt-4.1", "openai", "GPT-4.1", {
    npm: OPENAI_NPM,
    family: "gpt-4.1",
    capabilities: {
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(2, 8, 0.5, 0.5),
    limits: limits(1_047_576, 32_768),
  }),

  "gpt-4.1-mini": model("gpt-4.1-mini", "openai", "GPT-4.1 Mini", {
    npm: OPENAI_NPM,
    family: "gpt-4.1",
    capabilities: {
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(0.4, 1.6, 0.1, 0.1),
    limits: limits(1_047_576, 32_768),
  }),

  "gpt-4.1-nano": model("gpt-4.1-nano", "openai", "GPT-4.1 Nano", {
    npm: OPENAI_NPM,
    family: "gpt-4.1",
    capabilities: {
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(0.1, 0.4, 0.025, 0.025),
    limits: limits(1_047_576, 32_768),
  }),

  "gpt-5.3-codex": model("gpt-5.3-codex", "openai", "GPT-5.3 Codex", {
    npm: OPENAI_NPM,
    family: "gpt-codex",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
    },
    cost: cost(1.75, 14, 0.175),
    limits: limits(400_000, 128_000),
  }),

  "gpt-5.3-codex-spark": model("gpt-5.3-codex-spark", "openai", "GPT-5.3 Codex Spark", {
    npm: OPENAI_NPM,
    family: "gpt-codex-spark",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
    },
    cost: cost(1.75, 14, 0.175),
    limits: limits(128_000, 32_000),
  }),

  "gpt-5.4-mini": model("gpt-5.4-mini", "openai", "GPT-5.4 Mini", {
    npm: OPENAI_NPM,
    family: "gpt-mini",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(0.75, 4.5, 0.075),
    limits: limits(400_000, 128_000),
  }),

  "gpt-5.4-pro": model("gpt-5.4-pro", "openai", "GPT-5.4 Pro", {
    npm: OPENAI_NPM,
    family: "gpt-pro",
    capabilities: {
      temperature: false,
      reasoning: true,
      attachment: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
    },
    cost: cost(30, 180),
    limits: limits(1_050_000, 128_000),
  }),
};

// ── Anthropic Models ─────────────────────────────────────────────────

const ANTHROPIC_NPM = "@ai-sdk/anthropic";

export const ANTHROPIC_MODELS: Record<string, ModelInfo> = {
  "claude-sonnet-4-20250514": model(
    "claude-sonnet-4-20250514",
    "anthropic",
    "Claude Sonnet 4",
    {
      npm: ANTHROPIC_NPM,
      family: "claude",
      capabilities: {
        reasoning: true,
        attachment: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
      },
      cost: cost(3, 15, 0.3, 3.75),
      limits: limits(200_000, 16_384),
    },
  ),

  "claude-3-5-sonnet-20241022": model(
    "claude-3-5-sonnet-20241022",
    "anthropic",
    "Claude 3.5 Sonnet",
    {
      npm: ANTHROPIC_NPM,
      family: "claude",
      capabilities: {
        attachment: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
      },
      cost: cost(3, 15, 0.3, 3.75),
      limits: limits(200_000, 8_192),
    },
  ),

  "claude-3-5-haiku-20241022": model(
    "claude-3-5-haiku-20241022",
    "anthropic",
    "Claude 3.5 Haiku",
    {
      npm: ANTHROPIC_NPM,
      family: "claude",
      capabilities: {
        attachment: false,
      },
      cost: cost(0.8, 4, 0.08, 1),
      limits: limits(200_000, 8_192),
    },
  ),
};

// ── Fireworks Models (via openai-compatible) ─────────────────────────

const FIREWORKS_NPM = "@ai-sdk/openai-compatible";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";

export const FIREWORKS_MODELS: Record<string, ModelInfo> = {
  "accounts/fireworks/models/deepseek-v3": model(
    "accounts/fireworks/models/deepseek-v3",
    "fireworks",
    "DeepSeek V3 (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "deepseek",
      apiUrl: FIREWORKS_BASE_URL,
      cost: cost(0.9, 0.9),
      limits: limits(131_072, 8_192),
    },
  ),

  "accounts/fireworks/models/deepseek-r1": model(
    "accounts/fireworks/models/deepseek-r1",
    "fireworks",
    "DeepSeek R1 (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "deepseek",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
      },
      cost: cost(3, 8),
      limits: limits(131_072, 8_192),
    },
  ),

  "accounts/fireworks/models/llama-v3p3-70b-instruct": model(
    "accounts/fireworks/models/llama-v3p3-70b-instruct",
    "fireworks",
    "Llama 3.3 70B (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "llama",
      apiUrl: FIREWORKS_BASE_URL,
      cost: cost(0.9, 0.9),
      limits: limits(131_072, 16_384),
    },
  ),

  "accounts/fireworks/models/qwen3-235b-a22b": model(
    "accounts/fireworks/models/qwen3-235b-a22b",
    "fireworks",
    "Qwen3 235B (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "qwen",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
      },
      cost: cost(0.9, 0.9),
      limits: limits(131_072, 8_192),
    },
  ),

  "accounts/fireworks/models/kimi-k2p5": model(
    "accounts/fireworks/models/kimi-k2p5",
    "fireworks",
    "Kimi K2.5 (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "kimi-thinking",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
        input: { text: true, audio: false, image: true, video: true, pdf: false },
      },
      cost: cost(0.6, 3, 0.1),
      limits: limits(256_000, 256_000),
    },
  ),

  "accounts/fireworks/routers/kimi-k2p5-turbo": model(
    "accounts/fireworks/routers/kimi-k2p5-turbo",
    "fireworks",
    "Kimi K2.5 Turbo (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "kimi-thinking",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
      },
      cost: cost(0, 0),
      limits: limits(256_000, 256_000),
    },
  ),

  "accounts/fireworks/models/glm-5": model(
    "accounts/fireworks/models/glm-5",
    "fireworks",
    "GLM 5 (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "glm",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
      },
      cost: cost(1, 3.2, 0.5),
      limits: limits(202_752, 131_072),
    },
  ),

  "accounts/fireworks/models/minimax-m2p5": model(
    "accounts/fireworks/models/minimax-m2p5",
    "fireworks",
    "MiniMax M2.5 (Fireworks)",
    {
      npm: FIREWORKS_NPM,
      family: "minimax",
      apiUrl: FIREWORKS_BASE_URL,
      capabilities: {
        reasoning: true,
      },
      cost: cost(0.3, 1.2, 0.03),
      limits: limits(196_608, 196_608),
    },
  ),
};

// ── Provider Configs ─────────────────────────────────────────────────

/**
 * Built-in provider configurations.
 * Users just need to set the corresponding environment variables.
 */
export const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: makeProviderId("openai"),
    kind: "openai",
    apiKeyEnv: "OPENAI_API_KEY",
  },

  anthropic: {
    id: makeProviderId("anthropic"),
    kind: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },

  fireworks: {
    id: makeProviderId("fireworks"),
    kind: "openai-compatible",
    baseUrl: FIREWORKS_BASE_URL,
    apiKeyEnv: "FIREWORKS_API_KEY",
  },
};

// ── Registration Helper ──────────────────────────────────────────────

/**
 * All built-in models grouped by provider.
 */
export const BUILTIN_MODELS: Record<string, Record<string, Partial<ModelInfo>>> = {
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  fireworks: FIREWORKS_MODELS,
};

/**
 * Register all built-in providers and models with a provider registry.
 * Only registers providers whose API keys are available in the environment.
 *
 * @param registry - The provider registry to register with
 * @param options - Optional overrides
 * @param options.force - Register even if API key is not set
 */
export function registerBuiltins(
  registry: { register(config: ProviderConfig, models?: Record<string, Partial<ModelInfo>>): void },
  options?: { force?: boolean },
): void {
  for (const [id, config] of Object.entries(BUILTIN_PROVIDERS)) {
    // Always register OpenAI — OAuth auth (ChatGPT Plus/Pro) can provide
    // authentication without an API key via the Codex auth flow.
    if (!options?.force && id !== "openai") {
      const hasKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);
      if (!hasKey) continue;
    }

    const models = BUILTIN_MODELS[id];
    registry.register(config, models);
  }
}
