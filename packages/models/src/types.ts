/**
 * Provider-portable model abstraction types for OpenSlate.
 *
 * Follows the same pattern as opencode: uses the Vercel AI SDK (@ai-sdk/*) 
 * as the core provider abstraction, with a thin layer on top for:
 * - Role-based model routing (slots)
 * - Provider configuration
 * - Model metadata (capabilities, cost, limits)
 * - Normalized model registry
 *
 * Design rules:
 * - Provider choice is orthogonal to session/orchestrator logic
 * - Role-based model routing is first-class
 * - Provider-specific quirks are normalized behind AI SDK adapters
 * - Per-role model selection works across providers
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";

// ── Branded Identifiers ──────────────────────────────────────────────

export type ProviderId = string & { readonly __brand: "ProviderId" };
export type ModelId = string & { readonly __brand: "ModelId" };

export function makeProviderId(id: string): ProviderId {
  return id as ProviderId;
}

export function makeModelId(id: string): ModelId {
  return id as ModelId;
}

// ── Model Slots ──────────────────────────────────────────────────────

/**
 * Role-based model slots.
 * Each slot represents a runtime role that can be assigned to a different model/provider.
 */
export type ModelSlot =
  | "primary"    // strategic orchestration
  | "execute"    // code and tool-heavy work
  | "explore"    // research/query tasks
  | "search"     // web research and lightweight retrieval
  | "compress"   // summarization/compaction
  | "title"      // session title generation (optional)
  | "classify";  // classification/routing decisions (optional)

/** Configuration for a single model slot. */
export interface ModelSlotConfig {
  provider: ProviderId;
  model: ModelId;
  /** Optional temperature override for this slot. */
  temperature?: number;
  /** Optional max tokens override for this slot. */
  maxTokens?: number;
}

/** Full router configuration mapping slots to provider/model pairs. */
export interface ModelRouterConfig {
  /** Required slots. */
  primary: ModelSlotConfig;
  execute: ModelSlotConfig;
  explore: ModelSlotConfig;
  search: ModelSlotConfig;
  compress: ModelSlotConfig;
  /** Optional slots — fall back to primary if not configured. */
  title?: ModelSlotConfig;
  classify?: ModelSlotConfig;
}

// ── Provider Config ──────────────────────────────────────────────────

/** Configuration for a single provider backend. */
export interface ProviderConfig {
  id: ProviderId;
  /** 
   * Provider kind determines which AI SDK package to use.
   * Maps to npm packages like @ai-sdk/openai, @ai-sdk/anthropic, etc.
   */
  kind: "openai" | "anthropic" | "openai-compatible" | string;
  /** API base URL. */
  baseUrl?: string;
  /** API key. Can also be set via environment variable. */
  apiKey?: string;
  /** Environment variable name for the API key. */
  apiKeyEnv?: string;
  /** Extra headers to send with every request. */
  headers?: Record<string, string>;
  /** Provider-specific options passed to the AI SDK provider constructor. */
  options?: Record<string, unknown>;
}

// ── Model Capabilities ───────────────────────────────────────────────

export interface ModelCapabilities {
  /** Whether the model supports temperature control. */
  temperature: boolean;
  /** Whether the model supports extended thinking / reasoning. */
  reasoning: boolean;
  /** Whether the model supports file/image attachments. */
  attachment: boolean;
  /** Whether the model supports tool calling. */
  toolCall: boolean;
  /** Input modalities. */
  input: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  /** Output modalities. */
  output: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
}

// ── Model Info ────────────────────────────────────────────────────────

/** Cost per million tokens in USD. */
export interface ModelCost {
  input: number;
  output: number;
  cache: {
    read: number;
    write: number;
  };
}

export interface ModelLimits {
  /** Maximum context window in tokens. */
  context: number;
  /** Maximum input tokens (if different from context). */
  input?: number;
  /** Maximum output tokens. */
  output: number;
}

/**
 * Full model metadata.
 * Follows the same shape as opencode's Provider.Model, adapted for OpenSlate.
 */
export interface ModelInfo {
  id: ModelId;
  providerId: ProviderId;
  /** Display name. */
  name: string;
  /** Model family (e.g., "claude", "gpt"). */
  family?: string;
  /** The actual model ID to send to the API (may differ from our ID). */
  apiId: string;
  /** npm package for the AI SDK provider. */
  npm: string;
  /** API endpoint URL. */
  apiUrl?: string;
  /** Model status. */
  status: "active" | "beta" | "deprecated";
  /** Capabilities. */
  capabilities: ModelCapabilities;
  /** Cost per million tokens. */
  cost: ModelCost;
  /** Token limits. */
  limits: ModelLimits;
  /** Extra headers for this specific model. */
  headers?: Record<string, string>;
  /** Provider-specific model options. */
  options?: Record<string, unknown>;
}

// ── Provider Info ────────────────────────────────────────────────────

/**
 * A resolved provider with its available models.
 */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** How this provider was discovered. */
  source: "env" | "config" | "builtin";
  /** Environment variable names that can provide the API key. */
  env: string[];
  /** Resolved API key (if available). */
  apiKey?: string;
  /** Provider-level options. */
  options: Record<string, unknown>;
  /** Available models for this provider. */
  models: Record<string, ModelInfo>;
}

// ── Resolved Model ───────────────────────────────────────────────────

/**
 * A fully resolved model ready to use with the AI SDK.
 * Contains both the metadata and the actual AI SDK language model instance.
 */
export interface ResolvedModel {
  info: ModelInfo;
  provider: ProviderInfo;
  language: LanguageModelV3;
}

// ── Stream Events (pass-through from AI SDK) ─────────────────────────

// We re-export the AI SDK's streaming types rather than defining our own.
// This keeps us aligned with the ecosystem.
export type { LanguageModelV3 } from "@ai-sdk/provider";
