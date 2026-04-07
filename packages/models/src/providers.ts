/**
 * Provider registry — creates and manages AI SDK provider instances.
 *
 * Follows the opencode pattern: each provider maps to an @ai-sdk/* package.
 * The registry resolves provider configs into AI SDK language model instances.
 *
 * Supported providers:
 * - openai: @ai-sdk/openai (OpenAI direct, works with existing subscriptions)
 * - anthropic: @ai-sdk/anthropic (Anthropic direct)
 * - openai-compatible: @ai-sdk/openai-compatible (Fireworks, local models, any OpenAI-compatible API)
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  ProviderConfig,
  ProviderInfo,
  ModelInfo,
  ProviderId,
  ModelId,
  ResolvedModel,
} from "./types.js";
import { makeProviderId, makeModelId } from "./types.js";
import { Auth } from "./auth.js";
import type { AuthInfo, OAuthAuth } from "./auth.js";
import { CodexAuth, CODEX_ALLOWED_MODELS } from "./codex-auth.js";

// ── SDK Instance Cache ───────────────────────────────────────────────

type SDKInstance = {
  languageModel(modelId: string): LanguageModelV3;
  [key: string]: any;
};

const sdkCache = new Map<string, SDKInstance>();

function getCacheKey(config: ProviderConfig, hasAuth?: boolean): string {
  return JSON.stringify({
    kind: config.kind,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? "***" : undefined,
    apiKeyEnv: config.apiKeyEnv,
    hasAuth: hasAuth ?? false,
  });
}

// ── Provider SDK Creation ────────────────────────────────────────────

/**
 * Create an AI SDK provider instance from a provider config.
 * Caches instances by config signature for reuse.
 */
function createSDK(
  config: ProviderConfig,
  authOptions?: {
    apiKey?: string;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  },
): SDKInstance {
  const key = getCacheKey(config, !!authOptions);
  const cached = sdkCache.get(key);
  if (cached) return cached;

  const apiKey = authOptions?.apiKey ?? config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);

  let sdk: SDKInstance;

  switch (config.kind) {
    case "openai": {
      const provider = createOpenAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        ...(config.headers ? { headers: config.headers } : {}),
        ...(authOptions?.fetch ? { fetch: authOptions.fetch as typeof globalThis.fetch } : {}),
        ...((config.options ?? {}) as Record<string, any>),
      });
      // OpenAI SDK exposes .responses() for newer models and .languageModel() as fallback
      sdk = {
        languageModel: (modelId: string) => provider.languageModel(modelId),
        responses: (modelId: string) => provider.responses(modelId),
        provider,
      };
      break;
    }

    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        ...(config.headers ? { headers: config.headers } : {}),
        ...((config.options ?? {}) as Record<string, any>),
      });
      sdk = {
        languageModel: (modelId: string) => provider.languageModel(modelId),
        provider,
      };
      break;
    }

    case "openai-compatible": {
      const provider = createOpenAICompatible({
        name: config.id,
        apiKey,
        baseURL: config.baseUrl ?? "",
        ...(config.headers ? { headers: config.headers } : {}),
        ...((config.options ?? {}) as Record<string, any>),
      });
      sdk = {
        languageModel: (modelId: string) => provider.languageModel(modelId),
        chatModel: (modelId: string) => provider.chatModel(modelId),
        provider,
      };
      break;
    }

    default:
      throw new Error(`Unknown provider kind: ${config.kind}. Supported: openai, anthropic, openai-compatible`);
  }

  sdkCache.set(key, sdk);
  return sdk;
}

// ── Provider Registry ────────────────────────────────────────────────

export interface ProviderRegistry {
  /** All registered providers. */
  readonly providers: Map<ProviderId, ProviderInfo>;

  /** Register a provider from config. */
  register(config: ProviderConfig, models?: Record<string, Partial<ModelInfo>>): void;

  /** Get a provider by ID. */
  getProvider(id: ProviderId): ProviderInfo | undefined;

  /** Get a model by provider + model ID. */
  getModel(providerId: ProviderId, modelId: ModelId): ModelInfo | undefined;

  /** Resolve a model to an AI SDK LanguageModel instance. */
  resolve(providerId: ProviderId, modelId: ModelId): Promise<ResolvedModel>;

  /** List all available providers. */
  list(): ProviderInfo[];

  /** Invalidate cached SDK and model instances for a provider (e.g., when auth changes). */
  invalidateCache(providerId: ProviderId): void;
}

/**
 * Create a provider registry.
 * The registry manages provider configs and resolves them into AI SDK instances.
 */
export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<ProviderId, ProviderInfo>();
  const configs = new Map<ProviderId, ProviderConfig>();
  const languageModelCache = new Map<string, LanguageModelV3>();

  function register(
    config: ProviderConfig,
    models?: Record<string, Partial<ModelInfo>>,
  ): void {
    configs.set(config.id, config);

    const resolvedApiKey =
      config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);

    const resolvedModels: Record<string, ModelInfo> = {};
    if (models) {
      for (const [id, partial] of Object.entries(models)) {
        const modelId = makeModelId(id);
        resolvedModels[id] = {
          id: modelId,
          providerId: config.id,
          name: partial.name ?? id,
          family: partial.family,
          apiId: partial.apiId ?? id,
          npm: npmForKind(config.kind),
          apiUrl: config.baseUrl,
          status: partial.status ?? "active",
          capabilities: partial.capabilities ?? defaultCapabilities(),
          cost: partial.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limits: partial.limits ?? { context: 128_000, output: 4_096 },
          headers: partial.headers,
          options: partial.options,
        };
      }
    }

    const info: ProviderInfo = {
      id: config.id,
      name: config.id,
      source: "config",
      env: config.apiKeyEnv ? [config.apiKeyEnv] : [],
      apiKey: resolvedApiKey,
      options: config.options ?? {},
      models: resolvedModels,
    };

    providers.set(config.id, info);
  }

  function getProvider(id: ProviderId): ProviderInfo | undefined {
    return providers.get(id);
  }

  function getModel(providerId: ProviderId, modelId: ModelId): ModelInfo | undefined {
    const provider = providers.get(providerId);
    if (!provider) return undefined;
    return provider.models[modelId];
  }

  const oauthEnabledProviders = new Set<ProviderId>();

  async function resolve(providerId: ProviderId, modelId: ModelId): Promise<ResolvedModel> {
    const provider = providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}. Available: ${[...providers.keys()].join(", ")}`);
    }

    let model = provider.models[modelId];
    if (!model) {
      throw new Error(
        `Model not found: ${modelId} in provider ${providerId}. Available: ${Object.keys(provider.models).join(", ")}`,
      );
    }

    const config = configs.get(providerId);
    if (!config) {
      throw new Error(`Provider config not found: ${providerId}`);
    }

    // ── OAuth Integration ──────────────────────────────────────
    // OpenAI should still be registered even without OPENAI_API_KEY, because
    // OAuth auth (stored in Auth) can provide a dummy key + fetch wrapper.
    let authOptions:
      | {
          apiKey?: string;
          fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
        }
      | undefined;
    const storedAuth: AuthInfo | undefined = await Auth.get(providerId as string);
    const oauthAuth: OAuthAuth | undefined = storedAuth?.type === "oauth" ? storedAuth : undefined;

    if (config.kind === "openai") {
      const loaderResult = await CodexAuth.loader(providerId as string);
      if (loaderResult) {
        authOptions = loaderResult;

        if (!oauthEnabledProviders.has(providerId)) {
          invalidateCache(providerId);
          oauthEnabledProviders.add(providerId);
        }

        const filteredModels = CodexAuth.filterModels(provider.models);
        const zeroCostModels = CodexAuth.zeroCosts(filteredModels);
        provider.models = zeroCostModels;

        if (!provider.models[modelId]) {
          throw new Error(
            `Model ${modelId} is not available with OAuth subscription. Available: ${Object.keys(provider.models).join(", ")}. Allowed set size: ${CODEX_ALLOWED_MODELS.size}`,
          );
        }

        model = provider.models[modelId]!;
      } else if (oauthEnabledProviders.has(providerId) || oauthAuth) {
        // Auth mode changed or stale oauth state: clear caches so API-key mode can rehydrate cleanly.
        invalidateCache(providerId);
        oauthEnabledProviders.delete(providerId);
      }
    }

    const cacheKey = `${providerId}/${modelId}`;
    const cached = languageModelCache.get(cacheKey);
    if (cached) {
      return { info: model, provider, language: cached };
    }

    const sdk = createSDK(config, authOptions);

    // For OpenAI, use responses() for newer models (gpt-5+), languageModel() otherwise
    let language: LanguageModelV3;
    if (config.kind === "openai" && sdk.responses) {
      try {
        language = sdk.responses(model.apiId);
      } catch {
        language = sdk.languageModel(model.apiId);
      }
    } else {
      language = sdk.languageModel(model.apiId);
    }

    languageModelCache.set(cacheKey, language);
    return { info: model, provider, language };
  }

  function list(): ProviderInfo[] {
    return [...providers.values()];
  }

  function invalidateCache(providerId: ProviderId): void {
    const config = configs.get(providerId);
    if (config) {
      sdkCache.delete(getCacheKey(config, false));
      sdkCache.delete(getCacheKey(config, true));
    }

    // Clear SDK cache entries for this provider.
    for (const [key] of sdkCache) {
      if (key.includes(providerId)) {
        sdkCache.delete(key);
      }
    }

    // Clear language model cache entries.
    for (const [key] of languageModelCache) {
      if (key.startsWith(providerId + "/")) {
        languageModelCache.delete(key);
      }
    }
  }

  return { providers, register, getProvider, getModel, resolve, list, invalidateCache };
}

// ── Helpers ──────────────────────────────────────────────────────────

function npmForKind(kind: string): string {
  switch (kind) {
    case "openai":
      return "@ai-sdk/openai";
    case "anthropic":
      return "@ai-sdk/anthropic";
    case "openai-compatible":
      return "@ai-sdk/openai-compatible";
    default:
      return "@ai-sdk/openai-compatible";
  }
}

function defaultCapabilities(): ModelInfo["capabilities"] {
  return {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolCall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
  };
}
