/**
 * Plugin extension types.
 *
 * Minimal plugin interface — real plugin architecture comes in a later phase.
 */

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
}

export interface Plugin {
  manifest: PluginManifest;
  /** Called when the plugin is loaded. */
  activate(): Promise<void>;
  /** Called when the plugin is unloaded. */
  deactivate(): Promise<void>;
}
