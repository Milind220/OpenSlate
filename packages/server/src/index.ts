/**
 * @openslate/server
 *
 * Local control-plane server entry point.
 * Wires core runtime and model layer into an HTTP API.
 */

export { createServer } from "./server.js";
export type { ServerConfig, ServerDeps, OpenSlateServer } from "./server.js";

export { bootstrap } from "./bootstrap.js";
export type { BootstrapConfig } from "./bootstrap.js";
