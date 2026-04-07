import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import { Auth, OAUTH_DUMMY_KEY } from "./auth.js";
import type {
  AuthInfo,
  OAuthAuth,
  AuthHook,
  AuthMethod,
  AuthorizationResult,
  AuthCallbackResult,
} from "./auth.js";
import type { ModelInfo } from "./types.js";

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const ISSUER = "https://auth.openai.com";
export const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const OAUTH_PORT = 1455;
export const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;
export const VERSION = "0.1.0";

export interface PkceCodes {
  verifier: string;
  challenge: string;
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  } catch {
    return undefined;
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token);
    const accountId = claims && extractAccountIdFromClaims(claims);
    if (accountId) return accountId;
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token);
    return claims ? extractAccountIdFromClaims(claims) : undefined;
  }
  return undefined;
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "openslate",
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  return response.json();
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenSlate - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenSlate.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`;

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenSlate - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`;

interface PendingOAuth {
  pkce: PkceCodes;
  state: string;
  resolve: (tokens: TokenResponse) => void;
  reject: (error: Error) => void;
}

let oauthServer: ReturnType<typeof createServer> | undefined;
let pendingOAuth: PendingOAuth | undefined;

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` };
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`);

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        const errorMsg = errorDescription || error;
        pendingOAuth?.reject(new Error(errorMsg));
        pendingOAuth = undefined;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(HTML_ERROR(errorMsg));
        return;
      }

      if (!code) {
        const errorMsg = "Missing authorization code";
        pendingOAuth?.reject(new Error(errorMsg));
        pendingOAuth = undefined;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(HTML_ERROR(errorMsg));
        return;
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack";
        pendingOAuth?.reject(new Error(errorMsg));
        pendingOAuth = undefined;
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(HTML_ERROR(errorMsg));
        return;
      }

      const current = pendingOAuth;
      pendingOAuth = undefined;

      exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err));

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML_SUCCESS);
      return;
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"));
      pendingOAuth = undefined;
      res.writeHead(200);
      res.end("Login cancelled");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    oauthServer!.listen(OAUTH_PORT, () => {
      console.log("[codex-auth] oauth server started", { port: OAUTH_PORT });
      resolve();
    });
    oauthServer!.on("error", reject);
  });

  return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` };
}

function stopOAuthServer(): void {
  if (oauthServer) {
    oauthServer.close(() => {
      console.log("[codex-auth] oauth server stopped");
    });
    oauthServer = undefined;
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined;
          reject(new Error("OAuth callback timeout - authorization took too long"));
        }
      },
      5 * 60 * 1000,
    );

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout);
        resolve(tokens);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    };
  });
}

export const CODEX_ALLOWED_MODELS = new Set([
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
]);

function removeAuthorizationHeader(init?: RequestInit): RequestInit | undefined {
  if (!init?.headers) return init;

  if (init.headers instanceof Headers) {
    init.headers.delete("authorization");
    init.headers.delete("Authorization");
    return init;
  }

  if (Array.isArray(init.headers)) {
    init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization");
    return init;
  }

  delete init.headers.authorization;
  delete init.headers.Authorization;
  return init;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createCodexFetchWrapper(
  getAuth: () => Promise<AuthInfo | undefined>,
  accountId?: string,
): FetchFn {
  return async (requestInput: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const cleanInit = removeAuthorizationHeader(init);

    const currentAuth = await getAuth();
    if (!currentAuth || currentAuth.type !== "oauth") {
      return fetch(requestInput, cleanInit);
    }

    let oauth = currentAuth as OAuthAuth;
    let resolvedAccountId = oauth.accountId ?? accountId;

    if (!oauth.access || oauth.expires < Date.now()) {
      console.log("[codex-auth] refreshing access token");
      const tokens = await refreshAccessToken(oauth.refresh);
      const refreshedAuth: OAuthAuth = {
        type: "oauth",
        refresh: tokens.refresh_token,
        access: tokens.access_token,
        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        accountId: extractAccountId(tokens) || resolvedAccountId,
      };
      await Auth.set("openai", refreshedAuth);
      oauth = refreshedAuth;
      resolvedAccountId = refreshedAuth.accountId;
    }

    const headers = new Headers();

    if (cleanInit?.headers) {
      if (cleanInit.headers instanceof Headers) {
        cleanInit.headers.forEach((value, key) => headers.set(key, value));
      } else if (Array.isArray(cleanInit.headers)) {
        for (const [key, value] of cleanInit.headers) {
          if (value !== undefined) headers.set(key, String(value));
        }
      } else {
        for (const [key, value] of Object.entries(cleanInit.headers)) {
          if (value !== undefined) headers.set(key, String(value));
        }
      }
    }

    headers.set("authorization", `Bearer ${oauth.access}`);
    if (resolvedAccountId) {
      headers.set("ChatGPT-Account-Id", resolvedAccountId);
    }
    headers.set("originator", "openslate");
    headers.set("User-Agent", `openslate/${VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`);

    const parsed =
      requestInput instanceof URL
        ? requestInput
        : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);

    const url =
      parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
        ? new URL(CODEX_API_ENDPOINT)
        : parsed;

    return fetch(url, {
      ...cleanInit,
      headers,
    });
  };
}

async function authorizeWithBrowser(): Promise<AuthorizationResult> {
  const { redirectUri } = await startOAuthServer();
  const pkce = await generatePKCE();
  const state = generateState();
  const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);

  return {
    url: authUrl,
    instructions: "Complete authorization in your browser. This window will close automatically.",
    method: "auto",
    callback: async (): Promise<AuthCallbackResult> => {
      try {
        const tokens = await waitForOAuthCallback(pkce, state);
        const accountId = extractAccountId(tokens);
        return {
          type: "success",
          refresh: tokens.refresh_token,
          access: tokens.access_token,
          expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId,
        };
      } finally {
        stopOAuthServer();
      }
    },
  };
}

async function authorizeWithHeadlessDeviceFlow(): Promise<AuthorizationResult> {
  const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `openslate/${VERSION}`,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!deviceResponse.ok) {
    throw new Error("Failed to initiate device authorization");
  }

  const deviceData = (await deviceResponse.json()) as {
    device_auth_id: string;
    user_code: string;
    interval: string;
  };
  const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000;

  return {
    url: `${ISSUER}/codex/device`,
    instructions: `Enter code: ${deviceData.user_code}`,
    method: "auto",
    callback: async (): Promise<AuthCallbackResult> => {
      while (true) {
        const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `openslate/${VERSION}`,
          },
          body: JSON.stringify({
            device_auth_id: deviceData.device_auth_id,
            user_code: deviceData.user_code,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            authorization_code: string;
            code_verifier: string;
          };

          const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code: data.authorization_code,
              redirect_uri: `${ISSUER}/deviceauth/callback`,
              client_id: CLIENT_ID,
              code_verifier: data.code_verifier,
            }).toString(),
          });

          if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
          }

          const tokens = (await tokenResponse.json()) as TokenResponse;
          return {
            type: "success",
            refresh: tokens.refresh_token,
            access: tokens.access_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            accountId: extractAccountId(tokens),
          };
        }

        if (response.status !== 403 && response.status !== 404) {
          return { type: "failed" };
        }

        await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS);
      }
    },
  };
}

function authorizeApiKey(): never {
  throw new Error("API key auth does not use OAuth flow");
}

type AuthLoaderResult = { apiKey: string; fetch: FetchFn } | undefined;

export const CodexAuth = {
  provider: "openai",
  methods: [
    { type: "oauth", label: "ChatGPT Pro/Plus (browser)" },
    { type: "oauth", label: "ChatGPT Pro/Plus (headless)" },
    { type: "api", label: "Manually enter API Key" },
  ] as AuthMethod[],

  async authorize(methodIndex: number): Promise<AuthorizationResult> {
    if (methodIndex === 0) return authorizeWithBrowser();
    if (methodIndex === 1) return authorizeWithHeadlessDeviceFlow();
    if (methodIndex === 2) return authorizeApiKey();
    throw new Error(`Unknown auth method index: ${methodIndex}`);
  },

  async loader(providerId: string): Promise<AuthLoaderResult> {
    const auth = await Auth.get(providerId);
    if (!auth || auth.type !== "oauth") return undefined;

    const getAuth = () => Auth.get(providerId);
    return {
      apiKey: OAUTH_DUMMY_KEY,
      fetch: createCodexFetchWrapper(getAuth, auth.accountId),
    };
  },

  filterModels(models: Record<string, ModelInfo>): Record<string, ModelInfo> {
    const filtered: Record<string, ModelInfo> = {};
    for (const [id, model] of Object.entries(models)) {
      if (CODEX_ALLOWED_MODELS.has(id) || id.includes("codex")) {
        filtered[id] = model;
      }
    }
    return filtered;
  },

  zeroCosts(models: Record<string, ModelInfo>): Record<string, ModelInfo> {
    const updated: Record<string, ModelInfo> = {};
    for (const [id, model] of Object.entries(models)) {
      updated[id] = {
        ...model,
        cost: {
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        },
      };
    }
    return updated;
  },
} satisfies Pick<AuthHook, "provider" | "methods" | "authorize"> & {
  loader: (providerId: string) => Promise<AuthLoaderResult>;
  filterModels: (models: Record<string, ModelInfo>) => Record<string, ModelInfo>;
  zeroCosts: (models: Record<string, ModelInfo>) => Record<string, ModelInfo>;
};
