/**
 * @openslate/models
 *
 * Provider-portable model abstraction layer.
 * Defines model types, provider registry, router, transforms, and built-in models.
 */

// ── Types ────────────────────────────────────────────────────────────

export type {
  ProviderId,
  ModelId,
  ModelSlot,
  ModelSlotConfig,
  ModelRouterConfig,
  ProviderConfig,
  ModelCapabilities,
  ModelCost,
  ModelLimits,
  ModelInfo,
  ProviderInfo,
  ResolvedModel,
} from "./types.js";

export { makeProviderId, makeModelId } from "./types.js";

export type { LanguageModelV3 } from "./types.js";

// ── Auth ─────────────────────────────────────────────────────────────

export type {
  OAuthAuth,
  ApiKeyAuth,
  AuthInfo,
  AuthMethod,
  AuthorizationResult,
  AuthCallbackResult,
  AuthHook,
} from "./auth.js";

export { Auth, OAUTH_DUMMY_KEY } from "./auth.js";

// ── Codex Auth (OAuth for ChatGPT subscriptions) ─────────────────────

export {
  CodexAuth,
  CODEX_ALLOWED_MODELS,
  createCodexFetchWrapper,
} from "./codex-auth.js";

export type {
  IdTokenClaims,
  TokenResponse,
  PkceCodes,
} from "./codex-auth.js";

// ── Provider Registry ────────────────────────────────────────────────

export type { ProviderRegistry } from "./providers.js";
export { createProviderRegistry } from "./providers.js";

// ── Router ───────────────────────────────────────────────────────────

export type {
  ModelRouter,
  ModelRouterCallOptions,
  ModelRouterCompleteResult,
  ModelRouterStreamResult,
} from "./router.js";

export { createModelRouter } from "./router.js";

// ── Transform ────────────────────────────────────────────────────────

export { ProviderTransform } from "./transform.js";

// ── Built-in Models ──────────────────────────────────────────────────

export {
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  FIREWORKS_MODELS,
  BUILTIN_PROVIDERS,
  BUILTIN_MODELS,
  registerBuiltins,
} from "./builtins.js";
