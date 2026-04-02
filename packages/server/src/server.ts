/**
 * Local control-plane server.
 *
 * Minimal shape to prove core/models import cleanly.
 * Full API implementation comes in a later phase.
 */

import type { Session, SessionId } from "@openslate/core";
import type { ModelRouter } from "@openslate/models";

export interface ServerConfig {
  port: number;
  host?: string;
}

export interface ServerDeps {
  router: ModelRouter;
}

/**
 * Create the local control-plane server.
 * Placeholder — returns a minimal Bun server with health check.
 */
export function createServer(config: ServerConfig, _deps?: ServerDeps) {
  return {
    config,
    /** Start the server. */
    async start(): Promise<void> {
      // Placeholder — real implementation in a later phase.
      console.log(`[openslate] server listening on ${config.host ?? "localhost"}:${config.port}`);
    },
    /** Stop the server. */
    async stop(): Promise<void> {
      // Placeholder
    },
  };
}
