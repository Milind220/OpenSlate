import type Database from "bun:sqlite";
import {
  BUILTIN_MODELS,
  BUILTIN_PROVIDERS,
  createModelRouter,
  makeModelId,
  makeProviderId,
  registerBuiltins,
} from "@openslate/models";
import type {
  ModelRouter,
  ModelRouterConfig,
  ModelSlot,
  ModelSlotConfig,
  ProviderRegistry,
} from "@openslate/models";

const CONFIG_ID = "default";

export type RuntimeRole =
  | "primary"
  | "execute"
  | "explore"
  | "search"
  | "compress";

export interface RuntimeModelSelection {
  provider: string;
  model: string;
}

export interface AppConfig {
  providers: Record<
    string,
    { configured: boolean; authType: "api_key" | "oauth" | "none" }
  >;
  models: Record<RuntimeRole, RuntimeModelSelection | null>;
}

export interface RuntimeConfigService {
  getConfig(): AppConfig;
  setConfig(config: Partial<AppConfig>): AppConfig;
  login(provider: string, apiKey: string): { ok: boolean; provider: string };
  getRouter(): ModelRouter;
}

interface ProviderAuthRow {
  provider_id: string;
  auth_type: string;
  api_key: string | null;
}

const RUNTIME_ROLES: RuntimeRole[] = [
  "primary",
  "execute",
  "explore",
  "search",
  "compress",
];

export function createRuntimeConfigService(
  db: Database,
  registry: ProviderRegistry,
  explicitRouterConfig?: ModelRouterConfig,
): RuntimeConfigService {
  db.run(`
    CREATE TABLE IF NOT EXISTS runtime_config (
      id TEXT PRIMARY KEY,
      models_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS provider_auth (
      provider_id TEXT PRIMARY KEY,
      auth_type TEXT NOT NULL DEFAULT 'api_key',
      api_key TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  const getConfigStmt = db.prepare(
    "SELECT models_json FROM runtime_config WHERE id = ?",
  );
  const upsertConfigStmt = db.prepare(`
    INSERT INTO runtime_config (id, models_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET models_json = excluded.models_json, updated_at = excluded.updated_at
  `);

  const listAuthStmt = db.prepare(
    "SELECT provider_id, auth_type, api_key FROM provider_auth",
  );
  const upsertAuthStmt = db.prepare(`
    INSERT INTO provider_auth (provider_id, auth_type, api_key, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET auth_type = excluded.auth_type, api_key = excluded.api_key, updated_at = excluded.updated_at
  `);

  registerBuiltins(registry, { force: true });

  const readAuthRows = (): ProviderAuthRow[] =>
    listAuthStmt.all() as ProviderAuthRow[];

  const applyProviderAuth = (): void => {
    const authByProvider = new Map<string, ProviderAuthRow>(
      readAuthRows().map((row) => [row.provider_id, row]),
    );

    for (const [providerId, providerConfig] of Object.entries(
      BUILTIN_PROVIDERS,
    )) {
      const auth = authByProvider.get(providerId);
      const key =
        auth?.api_key ??
        providerConfig.apiKey ??
        (providerConfig.apiKeyEnv
          ? process.env[providerConfig.apiKeyEnv]
          : undefined);

      registry.register(
        {
          ...providerConfig,
          apiKey: key,
        },
        BUILTIN_MODELS[providerId],
      );

      registry.invalidateCache(makeProviderId(providerId));
    }
  };

  const safeParseModelAssignments = (
    raw: string | null,
  ): Partial<Record<RuntimeRole, RuntimeModelSelection>> => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Partial<Record<RuntimeRole, RuntimeModelSelection>> = {};
      for (const role of RUNTIME_ROLES) {
        const value = (parsed as Record<string, unknown>)[role];
        if (!value || typeof value !== "object") continue;
        const provider = (value as Record<string, unknown>).provider;
        const model = (value as Record<string, unknown>).model;
        if (
          typeof provider === "string" &&
          provider.trim() &&
          typeof model === "string" &&
          model.trim()
        ) {
          out[role] = { provider: provider.trim(), model: model.trim() };
        }
      }
      return out;
    } catch {
      return {};
    }
  };

  const readPersistedAssignments = (): Partial<
    Record<RuntimeRole, RuntimeModelSelection>
  > => {
    const row = getConfigStmt.get(CONFIG_ID) as { models_json: string } | null;
    return safeParseModelAssignments(row?.models_json ?? null);
  };

  const pickDefaultSelection = (): RuntimeModelSelection => {
    const providers = registry.list();
    const withCredentials = providers.find((p) => {
      const row = readAuthRows().find((r) => r.provider_id === p.id);
      const hasPersisted = !!row?.api_key;
      const hasEnv = p.env.some((env) => !!process.env[env]);
      return hasPersisted || hasEnv;
    });

    const provider =
      withCredentials ??
      providers.find((p) => Object.keys(p.models).length > 0);
    if (!provider) {
      throw new Error("No model provider is available.");
    }

    const model = Object.keys(provider.models)[0];
    if (!model) {
      throw new Error(`Provider ${provider.id} has no registered models.`);
    }

    return { provider: provider.id, model };
  };

  const validateSelection = (
    role: RuntimeRole,
    selection: RuntimeModelSelection,
  ): RuntimeModelSelection => {
    const provider = registry.getProvider(makeProviderId(selection.provider));
    if (!provider) {
      throw new Error(
        `Unknown provider for role ${role}: ${selection.provider}`,
      );
    }

    if (!provider.models[selection.model]) {
      throw new Error(
        `Unknown model for role ${role}: ${selection.provider}/${selection.model}. Available: ${Object.keys(provider.models).join(", ")}`,
      );
    }

    return {
      provider: selection.provider,
      model: selection.model,
    };
  };

  const resolveAssignments = (
    persisted: Partial<Record<RuntimeRole, RuntimeModelSelection>>,
    explicit?: ModelRouterConfig,
  ): Record<RuntimeRole, RuntimeModelSelection> => {
    const fallback = pickDefaultSelection();

    const resolved: Record<RuntimeRole, RuntimeModelSelection> = {
      primary: fallback,
      execute: fallback,
      explore: fallback,
      search: fallback,
      compress: fallback,
    };

    if (explicit) {
      for (const role of RUNTIME_ROLES) {
        const cfg = explicit[role as ModelSlot] as ModelSlotConfig | undefined;
        if (cfg) {
          resolved[role] = validateSelection(role, {
            provider: cfg.provider,
            model: cfg.model,
          });
        }
      }
      return resolved;
    }

    for (const role of RUNTIME_ROLES) {
      const value = persisted[role];
      if (!value) continue;
      resolved[role] = validateSelection(role, value);
    }

    return resolved;
  };

  const toRouterConfig = (
    models: Record<RuntimeRole, RuntimeModelSelection>,
  ): ModelRouterConfig => {
    const toSlot = (selection: RuntimeModelSelection): ModelSlotConfig => ({
      provider: makeProviderId(selection.provider),
      model: makeModelId(selection.model),
    });

    return {
      primary: toSlot(models.primary),
      execute: toSlot(models.execute),
      explore: toSlot(models.explore),
      search: toSlot(models.search),
      compress: toSlot(models.compress),
    };
  };

  const saveAssignments = (
    models: Record<RuntimeRole, RuntimeModelSelection>,
  ): void => {
    upsertConfigStmt.run(
      CONFIG_ID,
      JSON.stringify(models),
      new Date().toISOString(),
    );
  };

  applyProviderAuth();

  let currentAssignments = resolveAssignments(
    readPersistedAssignments(),
    explicitRouterConfig,
  );
  saveAssignments(currentAssignments);
  let router = createModelRouter(toRouterConfig(currentAssignments), registry);

  const getConfig = (): AppConfig => {
    const authRows = new Map<string, ProviderAuthRow>(
      readAuthRows().map((row) => [row.provider_id, row]),
    );
    const providers: AppConfig["providers"] = {};

    for (const provider of registry.list()) {
      const auth = authRows.get(provider.id);
      const hasPersistedKey = !!auth?.api_key;
      const hasEnv = provider.env.some((env) => !!process.env[env]);
      const configured = hasPersistedKey || hasEnv;
      providers[provider.id] = {
        configured,
        authType:
          auth?.auth_type === "oauth"
            ? "oauth"
            : configured
              ? "api_key"
              : "none",
      };
    }

    return {
      providers,
      models: {
        primary: currentAssignments.primary,
        execute: currentAssignments.execute,
        explore: currentAssignments.explore,
        search: currentAssignments.search,
        compress: currentAssignments.compress,
      },
    };
  };

  const setConfig = (config: Partial<AppConfig>): AppConfig => {
    const nextAssignments = { ...currentAssignments };
    const inputModels = config.models;

    if (inputModels) {
      for (const role of RUNTIME_ROLES) {
        const incoming = inputModels[role];
        if (!incoming) continue;
        nextAssignments[role] = validateSelection(role, incoming);
      }
    }

    currentAssignments = nextAssignments;
    saveAssignments(currentAssignments);
    router = createModelRouter(toRouterConfig(currentAssignments), registry);

    return getConfig();
  };

  const login = (
    provider: string,
    apiKey: string,
  ): { ok: boolean; provider: string } => {
    if (!provider.trim()) {
      throw new Error("Provider is required");
    }
    if (!apiKey.trim()) {
      throw new Error("API key is required");
    }

    const providerConfig = BUILTIN_PROVIDERS[provider];
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    upsertAuthStmt.run(
      provider,
      "api_key",
      apiKey.trim(),
      new Date().toISOString(),
    );
    applyProviderAuth();

    // Re-validate persisted assignments in case provider models changed.
    currentAssignments = resolveAssignments(currentAssignments, undefined);
    saveAssignments(currentAssignments);
    router = createModelRouter(toRouterConfig(currentAssignments), registry);

    return { ok: true, provider };
  };

  return {
    getConfig,
    setConfig,
    login,
    getRouter: () => router,
  };
}

export function getModelLabel(
  router: ModelRouter,
  slot: ModelSlot,
): Promise<string> {
  return router
    .resolve(slot)
    .then((resolved) => `${resolved.provider.id}/${resolved.info.id}`);
}

export async function estimateCostUsd(
  router: ModelRouter,
  slot: ModelSlot,
  usage:
    | { promptTokens: number; completionTokens: number; totalTokens: number }
    | null
    | undefined,
): Promise<number | null> {
  if (!usage) return null;
  const resolved = await router.resolve(slot);
  const inputCost = resolved.info.cost.input;
  const outputCost = resolved.info.cost.output;
  if (!Number.isFinite(inputCost) || !Number.isFinite(outputCost)) return null;
  const usd =
    (usage.promptTokens * inputCost + usage.completionTokens * outputCost) /
    1_000_000;
  return Number.isFinite(usd) ? Number(usd.toFixed(6)) : null;
}
