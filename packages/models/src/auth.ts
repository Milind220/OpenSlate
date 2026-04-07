/**
 * Auth storage for OpenSlate.
 *
 * Stores provider authentication credentials (API keys, OAuth tokens) in a
 * local JSON file (~/.openslate/auth.json). Ported from opencode's auth module,
 * simplified to use plain async/await instead of Effect.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── Constants ────────────────────────────────────────────────────────

/** Dummy API key used when OAuth is active (the real auth is in the fetch wrapper). */
export const OAUTH_DUMMY_KEY = "openslate-oauth-dummy-key";

const DATA_DIR = path.join(os.homedir(), ".openslate");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");

// ── Auth Types ───────────────────────────────────────────────────────

export interface OAuthAuth {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
}

export interface ApiKeyAuth {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
}

export type AuthInfo = OAuthAuth | ApiKeyAuth;

// ── Auth Methods ─────────────────────────────────────────────────────

/**
 * Auth method descriptor for provider authentication.
 */
export interface AuthMethod {
  type: "oauth" | "api";
  label: string;
}

/**
 * Result from an OAuth authorization flow.
 */
export interface AuthorizationResult {
  url: string;
  method: "auto" | "code";
  instructions: string;
  callback: (code?: string) => Promise<AuthCallbackResult>;
}

export type AuthCallbackResult =
  | { type: "success"; refresh: string; access: string; expires: number; accountId?: string }
  | { type: "failed" };

/**
 * Auth hook for a provider — defines how to authenticate.
 */
export interface AuthHook {
  provider: string;
  methods: AuthMethod[];
  authorize: (methodIndex: number) => Promise<AuthorizationResult>;
  /**
   * Called after auth is stored. Returns provider options (e.g., custom fetch).
   * The getAuth callback lets the hook read the current stored auth.
   */
  loader?: (
    getAuth: () => Promise<AuthInfo>,
    models: Record<string, any>,
  ) => Promise<{ apiKey?: string; fetch?: typeof globalThis.fetch } | undefined>;
}

// ── Storage ──────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAll(): Promise<Record<string, AuthInfo>> {
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf-8");
    const data = JSON.parse(raw);
    // Validate entries
    const result: Record<string, AuthInfo> = {};
    for (const [key, value] of Object.entries(data)) {
      if (isAuthInfo(value)) {
        result[key] = value as AuthInfo;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function isAuthInfo(value: unknown): value is AuthInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type === "oauth") {
    return typeof v.refresh === "string" && typeof v.access === "string" && typeof v.expires === "number";
  }
  if (v.type === "api") {
    return typeof v.key === "string";
  }
  return false;
}

async function writeAll(data: Record<string, AuthInfo>): Promise<void> {
  await ensureDir();
  await fs.writeFile(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ── Public API ───────────────────────────────────────────────────────

export const Auth = {
  /** Get auth info for a provider. */
  async get(providerId: string): Promise<AuthInfo | undefined> {
    const all = await readAll();
    return all[providerId];
  },

  /** Get all stored auth entries. */
  async all(): Promise<Record<string, AuthInfo>> {
    return readAll();
  },

  /** Store auth info for a provider. */
  async set(providerId: string, info: AuthInfo): Promise<void> {
    const all = await readAll();
    // Normalize trailing slashes
    const norm = providerId.replace(/\/+$/, "");
    if (norm !== providerId) delete all[providerId];
    delete all[norm + "/"];
    all[norm] = info;
    await writeAll(all);
  },

  /** Remove auth for a provider. */
  async remove(providerId: string): Promise<void> {
    const all = await readAll();
    const norm = providerId.replace(/\/+$/, "");
    delete all[providerId];
    delete all[norm];
    await writeAll(all);
  },
};
