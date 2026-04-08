/**
 * @openslate/sdk
 *
 * Typed client for the OpenSlate local control-plane API.
 */

export { createClient } from "./client.js";
export type {
  OpenSlateClientConfig,
  OpenSlateClient,
  SendMessageResponse,
  OrchestrateResponse,
} from "./client.js";