import { afterEach, beforeEach, expect, test, vi } from "vitest";

const platform = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  listener: null as null | ((message: { type: string }) => Promise<any>),
  beforeSet: null as null | ((values: Record<string, unknown>) => Promise<void>),
}));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { onMessage: { addListener: (listener: typeof platform.listener) => { platform.listener = listener; } } },
  identity: {
    getRedirectURL: () => "https://extension-id.chromiumapp.org/oauth2",
    launchWebAuthFlow: async ({ url }: { url: string }) => {
      const state = new URL(url).searchParams.get("state");
      return `https://extension-id.chromiumapp.org/oauth2?code=test-code&state=${state}`;
    },
  },
  storage: { local: {
    get: async (key: string | null) => key ? { [key]: platform.stored[key] } : { ...platform.stored },
    set: async (values: Record<string, unknown>) => { await platform.beforeSet?.(values); Object.assign(platform.stored, structuredClone(values)); },
    remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete platform.stored[key]; },
  } },
  tabs: { query: async () => [{ id: 7, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] },
} }));

const sessionKey = "blueprint_cloud_session_v1";
const ownerA = "018f6f68-9b4d-7c93-a134-c8571b8f7801";
const ownerB = "018f6f68-9b4d-7c93-a134-c8571b8f7802";
const eastern = { theme: { id: "eastern", version: 1 }, revision: 3 };
const cyberpunk = { theme: { id: "cyberpunk", version: 1 }, revision: 4 };
const snapshot = { schemaVersion: 1, id: ownerA, version: 1, title: "职业蓝图", goals: [] };
const http = vi.fn<typeof fetch>();

function signIn(userId = ownerA) {
  platform.stored[sessionKey] = { userId, accessToken: `token-${userId}`, refreshToken: "refresh", expiresAt: Date.now() + 3600_000 };
}

beforeEach(async () => {
  vi.resetModules();
  platform.stored = { blueprint_v3_cleanup_complete: true };
  platform.beforeSet = null;
  signIn();
  vi.stubEnv("WXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "extension-client");
  vi.stubEnv("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test");
  vi.stubEnv("WXT_PUBLIC_WEB_ORIGIN", "https://blueprint.example.test");
  vi.stubGlobal("defineBackground", (initialize: () => void) => initialize());
  vi.stubGlobal("fetch", http);
  http.mockReset();
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : snapshot));
  await import("../entrypoints/background");
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("the real extension runtime reads the authorized account theme separately from Blueprint state", async () => {
  const result = await platform.listener!({ type: "LOAD_CONTEXT" });
  expect(result).toMatchObject({ connected: true, userId: ownerA, snapshot, stale: false, preferences: eastern, preferencesStatus: "current" });
  const request = http.mock.calls.find(([url]) => String(url).endsWith("/account-preferences"));
  expect(request?.[1]).toMatchObject({ headers: { Authorization: `Bearer token-${ownerA}` } });
});

test("offline preferences use only the same owner's validated cache and do not mark the Blueprint stale", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  http.mockImplementation(async (url) => {
    if (String(url).endsWith("/account-preferences")) throw new TypeError("offline");
    return Response.json(snapshot);
  });
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, stale: false, preferences: eastern, preferencesStatus: "cached" });
  signIn(ownerB);
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, preferences: null, preferencesStatus: "unavailable" });
  platform.stored[`blueprint_preferences:${ownerB}`] = { ownerId: ownerA, preferences: eastern };
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: null, preferencesStatus: "unavailable" });
  platform.stored[`blueprint_preferences:${ownerB}`] = { ownerId: ownerB, preferences: { theme: { id: "https://invalid.test/theme", version: 1 }, revision: 3 } };
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: null, preferencesStatus: "unavailable" });
});

test("a preference 401 revokes the extension session and cannot later revive cached authorized state", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  http.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ connected: false });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: false });
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: false });
});

test("late preference responses cannot overwrite a newer read or restore another account", async () => {
  let release!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const oldRead = platform.listener!({ type: "LOAD_PREFERENCES" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  http.mockResolvedValue(Response.json(cyberpunk));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: cyberpunk });
  release(Response.json(eastern));
  expect(await oldRead).toMatchObject({ superseded: true });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: cyberpunk, preferencesStatus: "cached" });

  http.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  release = undefined!;
  const otherAccountRead = platform.listener!({ type: "LOAD_PREFERENCES" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  signIn(ownerB);
  release(Response.json(eastern));
  expect(await otherAccountRead).toMatchObject({ superseded: true });
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ userId: ownerB, preferences: null });
});

test("a rejected token refresh cannot leave an authorized theme cache available", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  http.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: false });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: false });
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ connected: false });
});

test("a token refresh finishing after disconnect cannot restore the old account", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  let release!: (response: Response) => void;
  http.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await platform.listener!({ type: "AUTH_DISCONNECT" });
  release(Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerA }))}.signature`, refresh_token: "rotated-refresh", expires_in: 3600 }));
  expect(await loading).toMatchObject({ connected: false });
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: false });
});

test("offline token refresh still permits only the saved owner's cached theme and Blueprint", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, userId: ownerA, stale: true, preferences: eastern, preferencesStatus: "cached" });
});

test("simultaneous context and theme reads share token rotation without spuriously disconnecting", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  let release!: (response: Response) => void;
  let rotations = 0;
  http.mockImplementation(async (url) => {
    if (String(url).endsWith("/oauth/token")) {
      if (++rotations > 1) return new Response(null, { status: 401 });
      return new Promise((resolve) => { release = resolve; });
    }
    return Response.json(String(url).endsWith("/account-preferences") ? eastern : snapshot);
  });
  const context = platform.listener!({ type: "LOAD_CONTEXT" });
  const theme = platform.listener!({ type: "LOAD_PREFERENCES" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  release(Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerA }))}.signature`, refresh_token: "rotated-refresh", expires_in: 3600 }));
  const results = await Promise.all([context, theme]);
  expect(results.every((result) => result.connected !== false)).toBe(true);
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: true });
});

test("a slow cache write cannot replace the theme from a newer preference read", async () => {
  let release!: () => void;
  platform.beforeSet = async (values) => {
    if (`blueprint_preferences:${ownerA}` in values && !release) await new Promise<void>((resolve) => { release = resolve; });
  };
  const old = platform.listener!({ type: "LOAD_PREFERENCES" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  http.mockResolvedValue(Response.json(cyberpunk));
  const fresh = platform.listener!({ type: "LOAD_PREFERENCES" });
  await vi.waitFor(() => expect(http.mock.calls.filter(([url]) => String(url).endsWith("/account-preferences"))).toHaveLength(2));
  release();
  await Promise.all([old, fresh]);
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: cyberpunk, preferencesStatus: "cached" });
});

test("loading account preferences does not wait for the Blueprint request to finish", async () => {
  let release!: (response: Response) => void;
  http.mockImplementation(async (url) => String(url).endsWith("/blueprint")
    ? new Promise((resolve) => { release = resolve; }) : Response.json(eastern));
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  try {
    await vi.waitFor(() => expect(http.mock.calls.some(([url]) => String(url).endsWith("/account-preferences"))).toBe(true), { timeout: 200 });
  } finally {
    release(Response.json(snapshot));
    await loading;
  }
});

test("disconnect wins over a token refresh already writing its session to storage", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  let release!: () => void;
  platform.beforeSet = async (values) => {
    if (sessionKey in values) await new Promise<void>((resolve) => { release = resolve; });
  };
  http.mockImplementation(async (url) => String(url).endsWith("/oauth/token")
    ? Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerA }))}.signature`, refresh_token: "rotated-refresh", expires_in: 3600 })
    : Response.json(String(url).endsWith("/account-preferences") ? eastern : snapshot));
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const disconnecting = platform.listener!({ type: "AUTH_DISCONNECT" });
  // Let the disconnect's immediate storage work run before releasing the
  // already-started write; a serialized implementation may still be waiting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([loading, disconnecting]);
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: false });
});

test("connecting a new account survives an older stalled refresh and disconnect", async () => {
  await platform.listener!({ type: "LOAD_CONTEXT" });
  (platform.stored[sessionKey] as { expiresAt: number }).expiresAt = 0;
  let release!: () => void;
  platform.beforeSet = async (values) => {
    if (sessionKey in values && !release) await new Promise<void>((resolve) => { release = resolve; });
  };
  http.mockImplementation(async (url, options) => {
    if (String(url).endsWith("/oauth/token")) {
      const owner = (options?.body as URLSearchParams).get("grant_type") === "authorization_code" ? ownerB : ownerA;
      return Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: owner }))}.signature`, refresh_token: `refresh-${owner}`, expires_in: 3600 });
    }
    return Response.json(String(url).endsWith("/account-preferences") ? cyberpunk : snapshot);
  });
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const disconnecting = platform.listener!({ type: "AUTH_DISCONNECT" });
  const connecting = platform.listener!({ type: "AUTH_CONNECT" });
  await vi.waitFor(() => expect(http.mock.calls.some(([, options]) => options?.body instanceof URLSearchParams && options.body.get("grant_type") === "authorization_code")).toBe(true));
  release();
  await Promise.all([loading, disconnecting, connecting]);
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toMatchObject({ connected: true, userId: ownerB });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ connected: true, userId: ownerB, preferences: null, preferencesStatus: "unavailable" });
});

test("a newer theme read cannot discard a valid current-video context from another runtime caller", async () => {
  const boundSnapshot = { ...snapshot, goals: [{ id: "018f6f68-9b4d-7c93-a134-c8571b8f7805", title: "目标", position: 0, stages: [{
    id: "018f6f68-9b4d-7c93-a134-c8571b8f7806", title: "起步", position: 0, nodes: [{
      id: "018f6f68-9b4d-7c93-a134-c8571b8f7803", type: "learn", title: "当前视频节点", position: 0, dependencyIds: [], resources: [{
        id: "018f6f68-9b4d-7c93-a134-c8571b8f7804", kind: "youtube_video", externalId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }],
    }],
  }] }] };
  let release!: (response: Response) => void;
  http.mockImplementation(async (url) => String(url).endsWith("/account-preferences")
    ? new Promise((resolve) => { release = resolve; }) : Response.json(boundSnapshot));
  const context = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  http.mockResolvedValue(Response.json(cyberpunk));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: cyberpunk, preferencesStatus: "current" });
  release(Response.json(eastern));
  expect(await context).toMatchObject({ connected: true, snapshot: boundSnapshot, context: { nodeTitle: "当前视频节点" }, preferences: cyberpunk });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_PREFERENCES" })).toMatchObject({ preferences: cyberpunk, preferencesStatus: "cached" });
});

test.each([ownerA, ownerB])("a delayed Blueprint cache write cannot survive disconnect and reconnect to %s", async (ownerId) => {
  let release!: () => void;
  platform.beforeSet = async (values) => {
    if (`blueprint_cache:${ownerA}` in values && !release) await new Promise<void>((resolve) => { release = resolve; });
  };
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await platform.listener!({ type: "AUTH_DISCONNECT" });
  release();
  await loading;
  http.mockResolvedValue(Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerId }))}.signature`, refresh_token: `new-${ownerId}`, expires_in: 3600 }));
  await platform.listener!({ type: "AUTH_CONNECT" });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, userId: ownerId, snapshot: null, stale: true });
  if (ownerId === ownerB) {
    http.mockResolvedValue(Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerA }))}.signature`, refresh_token: "new-owner-a", expires_in: 3600 }));
    await platform.listener!({ type: "AUTH_CONNECT" });
    http.mockRejectedValue(new TypeError("offline"));
    expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, userId: ownerA, snapshot: null });
  }
});

test.each([ownerA, ownerB])("a new session for %s can cache its Blueprint while old-cache cleanup is pending", async (ownerId) => {
  let release!: () => void;
  platform.beforeSet = async (values) => {
    if (`blueprint_cache:${ownerA}` in values && !release) await new Promise<void>((resolve) => { release = resolve; });
  };
  const old = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await platform.listener!({ type: "AUTH_DISCONNECT" });
  http.mockResolvedValue(Response.json({ access_token: `header.${btoa(JSON.stringify({ sub: ownerId }))}.signature`, refresh_token: `new-${ownerId}`, expires_in: 3600 }));
  await platform.listener!({ type: "AUTH_CONNECT" });
  const freshSnapshot = { ...snapshot, id: ownerId, version: 2, title: "新会话的蓝图" };
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? cyberpunk : freshSnapshot));
  const fresh = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(http.mock.calls.filter(([url]) => String(url).endsWith("/blueprint"))).toHaveLength(2));
  release();
  await old;
  expect(await fresh).toMatchObject({ connected: true, userId: ownerId, snapshot: freshSnapshot });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ connected: true, userId: ownerId, snapshot: freshSnapshot, stale: true });
});
