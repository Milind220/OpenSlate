/**
 * OpenAI-compatible adapter shape.
 *
 * This covers:
 * - OpenAI direct
 * - Fireworks (OpenAI-compatible endpoint)
 * - Local/open-weight models exposing OpenAI-compatible APIs
 * - Any other OpenAI-compatible provider
 *
 * This file defines the adapter config and type shape.
 * Full implementation comes in a later phase.
 */

import type { ModelAdapter, ModelRequest, ModelResponse, StreamEvent, ProviderConfig } from "../types.js";

export interface OpenAICompatibleAdapterConfig extends ProviderConfig {
  kind: "openai-compatible";
}

/**
 * Thin adapter shape for OpenAI-compatible providers.
 * Implementation is deferred — this proves the abstraction compiles.
 */
export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleAdapterConfig,
): ModelAdapter {
  return {
    providerId: config.id,

    async complete(_request: ModelRequest): Promise<ModelResponse> {
      throw new Error("OpenAI-compatible adapter not yet implemented");
    },

    async *stream(_request: ModelRequest): AsyncIterable<StreamEvent> {
      throw new Error("OpenAI-compatible adapter not yet implemented");
    },
  };
}
