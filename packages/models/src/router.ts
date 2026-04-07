/**
 * ModelRouter — resolves the correct model for a given slot and provides
 * convenient complete/stream methods using the Vercel AI SDK.
 *
 * The router bridges the runtime (which thinks in slots like "primary",
 * "execute", "compress") and the provider layer (which resolves provider
 * IDs and model names to AI SDK LanguageModelV3 instances).
 */

import type { ModelMessage, ToolSet } from "ai";
import { generateText, streamText } from "ai";
import type {
  ModelSlot,
  ModelSlotConfig,
  ModelRouterConfig,
  ResolvedModel,
} from "./types.js";
import type { ProviderRegistry } from "./providers.js";
import { ProviderTransform } from "./transform.js";

// ── Router Option/Result Types ───────────────────────────────────────

export interface ModelRouterCallOptions {
  /** Messages to send. */
  messages: ModelMessage[];
  /** System prompt. */
  system?: string;
  /** Tool definitions. */
  tools?: ToolSet;
  /** Temperature override (takes precedence over slot config). */
  temperature?: number;
  /** Max tokens override (takes precedence over slot config). */
  maxTokens?: number;
  /** Provider-specific options. */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Abort signal. */
  abortSignal?: AbortSignal;
}

/** Result of a complete() call. Inferred from generateText return type. */
export type ModelRouterCompleteResult = Awaited<ReturnType<typeof generateText>>;

/** Result of a stream() call. Inferred from streamText return type. */
export type ModelRouterStreamResult = ReturnType<typeof streamText>;

// ── ModelRouter Interface ────────────────────────────────────────────

export interface ModelRouter {
  /** Resolve the model for a given slot. Falls back to "primary" for unconfigured optional slots. */
  resolve(slot: ModelSlot): Promise<ResolvedModel>;

  /** Get the slot config for a given slot. */
  getSlotConfig(slot: ModelSlot): ModelSlotConfig;

  /** Complete a request using the model for the given slot. */
  complete(slot: ModelSlot, options: ModelRouterCallOptions): Promise<ModelRouterCompleteResult>;

  /** Stream a request using the model for the given slot. */
  stream(slot: ModelSlot, options: ModelRouterCallOptions): Promise<ModelRouterStreamResult>;
}

// ── Router Implementation ────────────────────────────────────────────

/**
 * Create a model router from a router config and provider registry.
 *
 * The router resolves slots to models via the registry, applying:
 * - Slot-level temperature/maxTokens overrides
 * - Provider-specific transform options
 * - Fallback from optional slots to "primary"
 */
export function createModelRouter(
  config: ModelRouterConfig,
  registry: ProviderRegistry,
): ModelRouter {
  // Cache resolved models per slot to avoid repeated lookups
  const resolvedCache = new Map<ModelSlot, ResolvedModel>();

  function getSlotConfig(slot: ModelSlot): ModelSlotConfig {
    const slotConfig = config[slot];
    if (slotConfig) return slotConfig;

    // Optional slots fall back to primary
    if (slot === "title" || slot === "classify") {
      return config.primary;
    }

    throw new Error(
      `No model configured for required slot "${slot}". Configure it in your ModelRouterConfig.`
    );
  }

  async function resolve(slot: ModelSlot): Promise<ResolvedModel> {
    const cached = resolvedCache.get(slot);
    if (cached) return cached;

    const slotConfig = getSlotConfig(slot);
    const resolved = await registry.resolve(slotConfig.provider, slotConfig.model);
    resolvedCache.set(slot, resolved);
    return resolved;
  }

  async function complete(
    slot: ModelSlot,
    options: ModelRouterCallOptions,
  ): Promise<ModelRouterCompleteResult> {
    const resolved = await resolve(slot);
    const slotConfig = getSlotConfig(slot);

    // Merge temperature: explicit option > slot config > provider transform
    const temperature =
      options.temperature ??
      slotConfig.temperature ??
      ProviderTransform.temperature(resolved.info);

    // Merge maxTokens: explicit option > slot config > provider transform
    const maxTokens =
      options.maxTokens ??
      slotConfig.maxTokens ??
      ProviderTransform.maxOutputTokens(resolved.info);

    // Build provider options
    const providerOpts = ProviderTransform.providerOptions(
      resolved.info,
      options.providerOptions ?? {},
    );

    return generateText({
      model: resolved.language,
      messages: options.messages,
      system: options.system,
      tools: options.tools,
      temperature,
      maxOutputTokens: maxTokens,
      providerOptions: providerOpts as any,
      abortSignal: options.abortSignal,
    });
  }

  async function stream(
    slot: ModelSlot,
    options: ModelRouterCallOptions,
  ): Promise<ModelRouterStreamResult> {
    const resolved = await resolve(slot);
    const slotConfig = getSlotConfig(slot);

    const temperature =
      options.temperature ??
      slotConfig.temperature ??
      ProviderTransform.temperature(resolved.info);

    const maxTokens =
      options.maxTokens ??
      slotConfig.maxTokens ??
      ProviderTransform.maxOutputTokens(resolved.info);

    const providerOpts = ProviderTransform.providerOptions(
      resolved.info,
      options.providerOptions ?? {},
    );

    return streamText({
      model: resolved.language,
      messages: options.messages,
      system: options.system,
      tools: options.tools,
      temperature,
      maxOutputTokens: maxTokens,
      providerOptions: providerOpts as any,
      abortSignal: options.abortSignal,
    });
  }

  return { resolve, getSlotConfig, complete, stream };
}
