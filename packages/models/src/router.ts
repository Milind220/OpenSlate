/**
 * ModelRouter — resolves the correct adapter for a given model slot.
 *
 * The router is the bridge between the runtime (which thinks in slots like
 * "primary", "execute", "compress") and the provider layer (which thinks
 * in provider IDs and model names).
 */

import type {
  ModelSlot,
  ModelSlotConfig,
  ModelRouterConfig,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from "./types.js";

export interface ModelRouter {
  /**
   * Resolve the adapter and model for a given slot.
   * Falls back to "primary" for optional slots that are not configured.
   */
  resolve(slot: ModelSlot): { adapter: ModelAdapter; config: ModelSlotConfig };

  /** Convenience: complete a request using the adapter for the given slot. */
  complete(slot: ModelSlot, request: Omit<ModelRequest, "model">): Promise<ModelResponse>;

  /** Convenience: stream a request using the adapter for the given slot. */
  stream(slot: ModelSlot, request: Omit<ModelRequest, "model">): AsyncIterable<StreamEvent>;
}
