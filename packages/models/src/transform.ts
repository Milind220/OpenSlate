/**
 * Provider-specific message normalization and request options.
 *
 * Borrowed from opencode's transform.ts, focused on OpenSlate's priority
 * providers: OpenAI, Anthropic, and Fireworks (via openai-compatible).
 *
 * Each function takes a ModelInfo and returns provider-appropriate values.
 */

import type { ModelMessage } from "ai";
import type { ModelInfo } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

// ── ProviderTransform Namespace ──────────────────────────────────────

export namespace ProviderTransform {
  // ── SDK Key Mapping ──────────────────────────────────────────────

  /**
   * Maps npm package name to the key the AI SDK expects for providerOptions.
   * This is critical for routing provider-specific options correctly.
   */
  function sdkKey(npm: string): string | undefined {
    switch (npm) {
      case "@ai-sdk/openai":
        return "openai";
      case "@ai-sdk/anthropic":
        return "anthropic";
      case "@ai-sdk/openai-compatible":
        return undefined; // Uses model-level providerOptions directly
      default:
        return undefined;
    }
  }

  // ── Message Normalization ────────────────────────────────────────

  /**
   * Normalize messages for provider-specific quirks.
   *
   * - Anthropic: rejects empty content, requires scrubbed tool call IDs
   * - Fireworks/openai-compatible: generally tolerant, minimal normalization
   * - OpenAI: mostly tolerant, but we scrub for safety
   */
  export function normalizeMessages(
    msgs: ModelMessage[],
    model: ModelInfo,
  ): ModelMessage[] {
    // Anthropic rejects messages with empty content
    if (model.npm === "@ai-sdk/anthropic") {
      msgs = msgs.filter((msg) => {
        if ("content" in msg && typeof msg.content === "string") {
          return msg.content !== "";
        }
        return true;
      });
    }

    // Claude models need scrubbed tool call IDs (only alphanumeric, underscore, hyphen)
    if (model.apiId.includes("claude") || model.npm === "@ai-sdk/anthropic") {
      const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
      msgs = msgs.map((msg) => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === "tool-call") {
                return { ...part, toolCallId: scrub(part.toolCallId) };
              }
              return part;
            }),
          };
        }
        if (msg.role === "tool") {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === "tool-result") {
                return { ...part, toolCallId: scrub(part.toolCallId) };
              }
              return part;
            }),
          };
        }
        return msg;
      });
    }

    return msgs;
  }

  // ── Prompt Caching ───────────────────────────────────────────────

  /**
   * Apply prompt caching markers for providers that support it.
   * Currently Anthropic and OpenAI support prompt caching.
   */
  export function applyCaching(
    msgs: ModelMessage[],
    model: ModelInfo,
    sessionId?: string,
  ): { messages: ModelMessage[]; providerOptions: Record<string, unknown> } {
    const providerOptions: Record<string, unknown> = {};

    // OpenAI prompt caching via session-scoped cache key
    if (model.npm === "@ai-sdk/openai" && sessionId) {
      providerOptions["openai"] = { promptCacheKey: sessionId };
    }

    // Anthropic prompt caching via ephemeral cache control on system + recent messages
    // Note: Anthropic caching is applied at the message level via providerOptions on
    // each message. For simplicity in v1, we just return the messages as-is and let
    // the AI SDK handle cache control headers.

    return { messages: msgs, providerOptions };
  }

  // ── Temperature ──────────────────────────────────────────────────

  /**
   * Returns the recommended temperature for a model, or undefined to use the
   * provider default.
   *
   * Follows opencode's pattern:
   * - Claude: undefined (use provider default)
   * - OpenAI reasoning models: undefined (temperature not supported)
   * - Everything else: undefined (use provider default)
   */
  export function temperature(model: ModelInfo): number | undefined {
    const id = model.apiId.toLowerCase();

    // Claude models: let the provider decide
    if (id.includes("claude")) return undefined;

    // OpenAI reasoning models (o1, o3, etc.) don't support temperature
    if (!model.capabilities.temperature) return undefined;

    return undefined;
  }

  // ── Max Output Tokens ────────────────────────────────────────────

  /**
   * Returns the max output tokens for a model, capped at a sensible default.
   */
  export function maxOutputTokens(model: ModelInfo): number {
    // Fireworks rejects non-streamed requests with max_tokens > 4096.
    // Phase 3 uses non-streamed complete() calls for the primary slot,
    // so cap this provider to a safe limit here.
    if (model.providerId === "fireworks") {
      return Math.min(model.limits.output, 4_096);
    }

    return Math.min(model.limits.output, DEFAULT_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS;
  }

  // ── Provider Options ─────────────────────────────────────────────

  /**
   * Wraps request options in the provider-specific namespace expected by the AI SDK.
   *
   * Example: for OpenAI, options go under { openai: { ... } }
   * For anthropic, under { anthropic: { ... } }
   * For openai-compatible, options are passed directly.
   */
  export function providerOptions(
    model: ModelInfo,
    options: Record<string, unknown>,
  ): Record<string, unknown> {
    const key = sdkKey(model.npm);
    if (!key) return options;
    return { [key]: options };
  }

  // ── Request Options ──────────────────────────────────────────────

  /**
   * Build provider-specific request options for a model.
   * Follows opencode's options() pattern.
   */
  export function requestOptions(
    model: ModelInfo,
    sessionId?: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // OpenAI: disable storage by default
    if (model.npm === "@ai-sdk/openai") {
      result["store"] = false;

      // Prompt cache key for session continuity
      if (sessionId) {
        result["promptCacheKey"] = sessionId;
      }
    }

    // Anthropic: enable extended thinking for reasoning models
    if (model.npm === "@ai-sdk/anthropic" && model.capabilities.reasoning) {
      result["thinking"] = {
        type: "enabled",
        budgetTokens: Math.min(16_000, Math.floor(model.limits.output / 2 - 1)),
      };
    }

    return result;
  }

  // ── Reasoning Variants ───────────────────────────────────────────

  /**
   * Returns available reasoning effort variants for a model.
   * Each variant maps a name (e.g., "low", "high") to provider-specific options.
   */
  export function reasoningVariants(
    model: ModelInfo,
  ): Record<string, Record<string, unknown>> {
    if (!model.capabilities.reasoning) return {};

    switch (model.npm) {
      case "@ai-sdk/openai":
        return {
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
        };

      case "@ai-sdk/anthropic":
        return {
          high: {
            thinking: {
              type: "enabled",
              budgetTokens: Math.min(16_000, Math.floor(model.limits.output / 2 - 1)),
            },
          },
          max: {
            thinking: {
              type: "enabled",
              budgetTokens: Math.min(31_999, model.limits.output - 1),
            },
          },
        };

      case "@ai-sdk/openai-compatible":
        // Fireworks and other openai-compatible providers
        return {
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
        };

      default:
        return {};
    }
  }

  // ── Small Model Options ──────────────────────────────────────────

  /**
   * Returns minimal options for lightweight requests (titles, classification).
   * Reduces reasoning effort and disables expensive features.
   */
  export function smallOptions(model: ModelInfo): Record<string, unknown> {
    if (model.npm === "@ai-sdk/openai") {
      return { store: false };
    }
    return {};
  }
}
