/**
 * @openslate/models
 *
 * Provider-portable model abstraction layer.
 * Defines ModelProvider, ModelAdapter, ModelRouter, and role-based model slots.
 */

export type {
  ModelSlot,
  ModelSlotConfig,
  ModelRouterConfig,
  ProviderConfig,
  ModelMessage,
  ModelMessagePart,
  ToolDefinitionParam,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelUsage,
  StreamEventKind,
  StreamEvent,
  ModelProvider,
  ModelAdapter,
} from "./types.js";

export type { ModelRouter } from "./router.js";

export { createOpenAICompatibleAdapter } from "./adapters/openai-compatible.js";
export type { OpenAICompatibleAdapterConfig } from "./adapters/openai-compatible.js";
