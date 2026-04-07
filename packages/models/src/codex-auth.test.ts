import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

const mockAuth = {
  get: mock(async (_providerId: string) => undefined as any),
  set: mock(async (_providerId: string, _info: any) => {}),
  remove: mock(async (_providerId: string) => {}),
  all: mock(async () => ({})),
};

mock.module("./auth.js", () => ({
  Auth: mockAuth,
  OAUTH_DUMMY_KEY: "openslate-oauth-dummy-key",
}));

const {
  CLIENT_ID,
  ISSUER,
  CODEX_API_ENDPOINT,
  OAUTH_PORT,
  VERSION,
  CODEX_ALLOWED_MODELS,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  createCodexFetchWrapper,
  CodexAuth,
} = await import("./codex-auth.js");

function makeJwt(payload: object): string {
  return (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9." +
    Buffer.from(JSON.stringify(payload)).toString("base64url") +
    ".fake-signature"
  );
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const originalFetch = globalThis.fetch;

function mockCallAt(
  fn: { mock: { calls: unknown[][] } },
  index: number,
): [RequestInfo | URL, RequestInit | undefined] {
  const call = fn.mock.calls[index] as [RequestInfo | URL, RequestInit?] | undefined;
  expect(call).toBeDefined();
  return [call![0], call![1]];
}

beforeEach(() => {
  (mockAuth.get as any).mockClear?.();
  (mockAuth.set as any).mockClear?.();
  (mockAuth.remove as any).mockClear?.();
  (mockAuth.all as any).mockClear?.();

  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected network call in test: ${toUrl(input)}`);
  }) as any;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
});

describe("codex-auth: PKCE & JWT utilities", () => {
  test("parseJwtClaims parses valid JWT payload", () => {
    const token = makeJwt({ chatgpt_account_id: "acct_123", email: "test@example.com" });
    expect(parseJwtClaims(token)).toEqual({
      chatgpt_account_id: "acct_123",
      email: "test@example.com",
    });
  });

  test("parseJwtClaims returns undefined for malformed token", () => {
    expect(parseJwtClaims("not.a.jwt")).toBeUndefined();
    expect(parseJwtClaims("missing-parts")).toBeUndefined();
    expect(parseJwtClaims("a.b.c.d")).toBeUndefined();
  });

  test("extractAccountIdFromClaims follows precedence: direct -> namespaced -> organizations", () => {
    expect(
      extractAccountIdFromClaims({
        chatgpt_account_id: "direct",
        "https://api.openai.com/auth": { chatgpt_account_id: "namespaced" },
        organizations: [{ id: "org_1" }],
      }),
    ).toBe("direct");

    expect(
      extractAccountIdFromClaims({
        "https://api.openai.com/auth": { chatgpt_account_id: "namespaced" },
        organizations: [{ id: "org_1" }],
      }),
    ).toBe("namespaced");

    expect(extractAccountIdFromClaims({ organizations: [{ id: "org_1" }] })).toBe("org_1");
    expect(extractAccountIdFromClaims({})).toBeUndefined();
  });

  test("extractAccountId prefers id_token then falls back to access_token", () => {
    const idToken = makeJwt({ chatgpt_account_id: "acct_from_id" });
    const accessToken = makeJwt({ chatgpt_account_id: "acct_from_access" });

    expect(
      extractAccountId({
        id_token: idToken,
        access_token: accessToken,
        refresh_token: "refresh",
      }),
    ).toBe("acct_from_id");

    expect(
      extractAccountId({
        id_token: makeJwt({ email: "no-account@id-token" }),
        access_token: accessToken,
        refresh_token: "refresh",
      }),
    ).toBe("acct_from_access");

    expect(
      extractAccountId({
        id_token: "bad-token",
        access_token: "also.bad.token",
        refresh_token: "refresh",
      }),
    ).toBeUndefined();
  });
});

describe("codex-auth: filterModels", () => {
  test("keeps allowed models and codex substring models", () => {
    const models = {
      "gpt-5.4": { name: "allowed-by-set" },
      "my-codex-experimental": { name: "allowed-by-substring" },
      "gpt-4o": { name: "should-be-removed" },
    } as any;

    const filtered = CodexAuth.filterModels(models);

    expect(Object.keys(filtered).sort()).toEqual(["gpt-5.4", "my-codex-experimental"]);
    expect(CODEX_ALLOWED_MODELS.has("gpt-5.4")).toBeTrue();
  });
});

describe("codex-auth: zeroCosts", () => {
  test("sets all model costs to zero while preserving other fields", () => {
    const models = {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT 5.4",
        family: "gpt",
        cost: { input: 10, output: 20, cache: { read: 1, write: 2 } },
      },
    } as any;

    const zeroed = CodexAuth.zeroCosts(models);

    expect(zeroed["gpt-5.4"]?.name).toBe("GPT 5.4");
    expect(zeroed["gpt-5.4"]?.cost).toEqual({
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    });
  });
});

describe("codex-auth: loader", () => {
  test("returns undefined when auth is missing or not oauth", async () => {
    mockAuth.get.mockResolvedValueOnce(undefined);
    expect(await CodexAuth.loader("openai")).toBeUndefined();

    mockAuth.get.mockResolvedValueOnce({ type: "api", key: "sk-key" });
    expect(await CodexAuth.loader("openai")).toBeUndefined();
  });

  test("returns OAuth dummy key and wrapped fetch for oauth auth", async () => {
    const getSpy = spyOn(mockAuth, "get");
    getSpy.mockResolvedValue({
      type: "oauth",
      refresh: "refresh",
      access: "access",
      expires: Date.now() + 60_000,
      accountId: "acct_loader",
    });

    const loaded = await CodexAuth.loader("openai");

    expect(loaded?.apiKey).toBe("openslate-oauth-dummy-key");
    expect(typeof loaded?.fetch).toBe("function");
    expect(getSpy).toHaveBeenCalledWith("openai");
  });
});

describe("codex-auth: createCodexFetchWrapper", () => {
  test("falls back to plain fetch for non-OAuth auth and strips Authorization", async () => {
    const fetchMock = mock(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const wrapped = createCodexFetchWrapper(async () => ({ type: "api", key: "sk_123" } as any));

    await wrapped("https://example.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer should-not-pass",
        "x-test": "1",
      },
    });

    const [, init] = mockCallAt(fetchMock as any, 0);
    expect((init as RequestInit).headers).toEqual({ "x-test": "1" });
  });

  test("adds OAuth headers, rewrites /v1/responses URL, and preserves custom headers", async () => {
    const fetchMock = mock(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const wrapped = createCodexFetchWrapper(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh",
          access: "oauth_access",
          expires: Date.now() + 60_000,
          accountId: "acct_auth",
        }) as any,
      "acct_param_fallback",
    );

    await wrapped("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer remove-me",
        "x-extra": "kept",
      },
    });

    const [input, init] = mockCallAt(fetchMock as any, 0);
    const headers = (init as RequestInit).headers as Headers;

    expect(toUrl(input as any)).toBe(CODEX_API_ENDPOINT);
    expect(headers.get("authorization")).toBe("Bearer oauth_access");
    expect(headers.get("ChatGPT-Account-Id")).toBe("acct_auth");
    expect(headers.get("originator")).toBe("openslate");
    expect(headers.get("User-Agent")?.startsWith(`openslate/${VERSION}`)).toBeTrue();
    expect(headers.get("x-extra")).toBe("kept");
  });

  test("rewrites /chat/completions and uses fallback account id argument", async () => {
    const fetchMock = mock(async () => new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as any;

    const wrapped = createCodexFetchWrapper(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh",
          access: "oauth_access",
          expires: Date.now() + 60_000,
        }) as any,
      "acct_from_param",
    );

    await wrapped("https://api.openai.com/chat/completions", { headers: { "x-test": "1" } });

    const [input, init] = mockCallAt(fetchMock as any, 0);
    const headers = (init as RequestInit).headers as Headers;

    expect(toUrl(input as any)).toBe(CODEX_API_ENDPOINT);
    expect(headers.get("ChatGPT-Account-Id")).toBe("acct_from_param");
  });

  test("refreshes expired token, persists updated auth, and uses refreshed access token", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url === `${ISSUER}/oauth/token`) {
        return new Response(
          JSON.stringify({
            id_token: makeJwt({ chatgpt_account_id: "acct_refreshed" }),
            access_token: "new_access",
            refresh_token: "new_refresh",
            expires_in: 120,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("ok", { status: 200 });
    });
    globalThis.fetch = fetchMock as any;

    const wrapped = createCodexFetchWrapper(async () => ({
      type: "oauth",
      refresh: "old_refresh",
      access: "old_access",
      expires: Date.now() - 1,
    }));

    await wrapped("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer stale" },
    });

    expect(fetchMock.mock.calls.length).toBe(2);
    expect(toUrl(fetchMock.mock.calls[0]![0] as any)).toBe(`${ISSUER}/oauth/token`);
    expect(mockAuth.set).toHaveBeenCalledTimes(1);
    expect(mockAuth.set).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({
        type: "oauth",
        refresh: "new_refresh",
        access: "new_access",
        accountId: "acct_refreshed",
      }),
    );

    const [, requestInit] = mockCallAt(fetchMock as any, 1);
    const headers = (requestInit as RequestInit).headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer new_access");
  });
});

describe("codex-auth: OAuth server integration", () => {
  test("authorize(0) callback succeeds via /auth/callback and exchanges code", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url === `${ISSUER}/oauth/token`) {
        return new Response(
          JSON.stringify({
            id_token: makeJwt({ chatgpt_account_id: "acct_server" }),
            access_token: "access_server",
            refresh_token: "refresh_server",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;

    const authorization = await CodexAuth.authorize(0);
    const state = new URL(authorization.url).searchParams.get("state");
    expect(state).toBeString();

    const callbackPromise = authorization.callback();

    const httpResponse = await originalFetch(
      `http://localhost:${OAUTH_PORT}/auth/callback?code=test_code&state=${state}`,
    );
    expect(httpResponse.status).toBe(200);
    expect(await httpResponse.text()).toContain("Authorization Successful");

    await expect(callbackPromise).resolves.toEqual(
      expect.objectContaining({
        type: "success",
        refresh: "refresh_server",
        access: "access_server",
        accountId: "acct_server",
      }),
    );
  });

  test("/cancel rejects pending callback", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("exchange should not run for cancel path");
    }) as any;

    const authorization = await CodexAuth.authorize(0);
    const callbackPromise = authorization.callback().catch((e: Error) => e);

    const cancelResponse = await originalFetch(`http://localhost:${OAUTH_PORT}/cancel`);
    expect(cancelResponse.status).toBe(200);
    expect(await cancelResponse.text()).toContain("Login cancelled");

    const result = await callbackPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Login cancelled");
  });

  test("unknown OAuth server route returns 404", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("exchange should not run for 404 path");
    }) as any;

    const authorization = await CodexAuth.authorize(0);
    const callbackPromise = authorization.callback().catch((e: Error) => e);

    const notFound = await originalFetch(`http://localhost:${OAUTH_PORT}/does-not-exist`);
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe("Not found");

    await originalFetch(`http://localhost:${OAUTH_PORT}/cancel`);
    const result = await callbackPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Login cancelled");
  });
});

describe("codex-auth: authorize routing", () => {
  test("method 1 uses headless device flow bootstrap", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = toUrl(input);
      if (url === `${ISSUER}/api/accounts/deviceauth/usercode`) {
        return new Response(
          JSON.stringify({
            device_auth_id: "dev_123",
            user_code: "ABCD-EFGH",
            interval: "1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch for method 1: ${url}`);
    }) as any;

    const authorization = await CodexAuth.authorize(1);

    expect(authorization.url).toBe(`${ISSUER}/codex/device`);
    expect(authorization.method).toBe("auto");
    expect(authorization.instructions).toContain("ABCD-EFGH");
  });

  test("method 2 throws API key OAuth error", async () => {
    await expect(CodexAuth.authorize(2)).rejects.toThrow("API key auth does not use OAuth flow");
  });

  test("unknown method index throws", async () => {
    await expect(CodexAuth.authorize(999)).rejects.toThrow("Unknown auth method index: 999");
  });
});

describe("codex-auth: provider registry integration", () => {
  test("exports provider metadata and expected auth methods", () => {
    expect(CodexAuth.provider).toBe("openai");
    expect(CodexAuth.methods.map((m) => m.type)).toEqual(["oauth", "oauth", "api"]);
    expect(CodexAuth.methods).toHaveLength(3);
    expect(CodexAuth.methods[0]?.label).toContain("browser");
    expect(CLIENT_ID).toBeString();
  });
});

// Sanity check constants are stable and available for OAuth flow wiring.
describe("codex-auth: exported constants", () => {
  test("issuer, endpoint and port are wired", () => {
    expect(ISSUER).toBe("https://auth.openai.com");
    expect(CODEX_API_ENDPOINT).toContain("chatgpt.com/backend-api/codex/responses");
    expect(OAUTH_PORT).toBe(1455);
    expect(VERSION).toBe("0.1.0");
  });
});
