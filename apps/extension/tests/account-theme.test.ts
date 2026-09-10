import { afterEach, beforeEach, expect, test, vi } from "vitest";

const platform = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  listener: null as null | ((message: { type: string; ownerId?: string; input?: unknown; tabId?: number; context?: unknown; url?: string }) => Promise<any>),
  beforeSet: null as null | ((values: Record<string, unknown>) => Promise<void>),
  tab: { id: 7, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  created: [] as string[],
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
  tabs: { query: async () => [{ ...platform.tab }], create: async ({ url }: { url: string }) => { platform.created.push(url); } },
} }));

const sessionKey = "blueprint_cloud_session_v1";
const ownerA = "018f6f68-9b4d-7c93-a134-c8571b8f7801";
const ownerB = "018f6f68-9b4d-7c93-a134-c8571b8f7802";
const eastern = { theme: { id: "eastern", version: 1 }, revision: 3 };
const cyberpunk = { theme: { id: "cyberpunk", version: 1 }, revision: 4 };
const snapshot = { schemaVersion: 1, id: ownerA, version: 1, title: "职业蓝图", goals: [] };
const http = vi.fn<typeof fetch>();
const boundSnapshot = { ...snapshot, schemaVersion: 2, goals: [{ id: "018f6f68-9b4d-7c93-a134-c8571b8f7805", title: "目标", position: 0, stages: [{
  id: "018f6f68-9b4d-7c93-a134-c8571b8f7806", title: "起步", position: 0, nodes: [{
    id: "018f6f68-9b4d-7c93-a134-c8571b8f7803", type: "learn", title: "当前视频节点", description: "为目标掌握基础", estimatedMinutes: 45, completionCriteria: "能独立解释", position: 0, dependencyIds: [], resources: [{
      id: "018f6f68-9b4d-7c93-a134-c8571b8f7804", kind: "youtube_video", externalId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }],
  }],
}] }] };
const boundContext = { nodeId: "018f6f68-9b4d-7c93-a134-c8571b8f7803", resourceBindingId: "018f6f68-9b4d-7c93-a134-c8571b8f7804" };

function signIn(userId = ownerA) {
  platform.stored[sessionKey] = { userId, accessToken: `token-${userId}`, refreshToken: "refresh", expiresAt: Date.now() + 3600_000 };
}

beforeEach(async () => {
  vi.resetModules();
  platform.stored = { blueprint_v3_cleanup_complete: true };
  platform.beforeSet = null;
  platform.tab = { id: 7, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
  platform.created = [];
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

test("starting learning rejects the panel's previous owner before any write or outbox command", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerB, tabId: 7, context: boundContext })).toEqual({ ok: false, code: "forbidden" });
  expect(http.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("LOAD_CONTEXT exposes honest planning details in a plural binding projection", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  const result = await platform.listener!({ type: "LOAD_CONTEXT" });
  expect(result).toMatchObject({ userId: ownerA, tabId: 7, contexts: [{ ...boundContext, goalTitle: "目标", stageTitle: "起步", description: "为目标掌握基础", estimatedMinutes: 45, completionCriteria: "能独立解释" }] });
  expect(result).not.toHaveProperty("context");
});

test("valid learning context sends only selected stable IDs and an idempotency identity", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: { ...boundContext, nodeTitle: "伪造标题" } })).toEqual({ ok: true, queued: false });
  const writes = http.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(String(writes[0]![0])).toBe("https://blueprint.example.test/api/v1/learning-sessions");
  expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({ ...boundContext, startedAt: expect.any(String), clientMutationId: expect.any(String) });
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test.each(["START_SESSION", "OPEN_PATH"])("%s rejects changed active tab, video, binding and missing selection without effects", async (type) => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  for (const request of [
    { ownerId: ownerA, tabId: 8, context: boundContext },
    { ownerId: ownerA, tabId: 7, context: { ...boundContext, resourceBindingId: ownerB } },
    { ownerId: ownerA, tabId: 7, context: undefined },
  ]) expect(await platform.listener!({ type, ...request })).toEqual({ ok: false, code: "source_changed" });
  platform.tab.url = "https://www.youtube.com/watch?v=abcdefghijk";
  expect(await platform.listener!({ type, ownerId: ownerA, tabId: 7, context: boundContext })).toEqual({ ok: false, code: "source_changed" });
  expect(http.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(platform.created).toEqual([]);
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("OPEN_PATH uses configured origin and stored goal/node, never caller URL or goal text", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  expect(await platform.listener!({ type: "OPEN_PATH", ownerId: ownerA, tabId: 7, context: { ...boundContext, goalId: "javascript:alert(1)" }, url: "https://evil.test/private" })).toEqual({ ok: true });
  expect(platform.created).toEqual(["https://blueprint.example.test/paths/018f6f68-9b4d-7c93-a134-c8571b8f7805#node-018f6f68-9b4d-7c93-a134-c8571b8f7803"]);
  expect(http.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});

test.each(["START_SESSION", "OPEN_PATH"])("%s rechecks owner and navigation after a delayed context read", async (type) => {
  let release!: (response: Response) => void;
  http.mockImplementation(async (url) => String(url).endsWith("/blueprint") ? new Promise((resolve) => { release = resolve; }) : Response.json(eastern));
  const waiting = platform.listener!({ type, ownerId: ownerA, tabId: 7, context: boundContext });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  signIn(ownerB);
  release(Response.json(boundSnapshot));
  expect(await waiting).toEqual({ ok: false, code: "forbidden" });
  signIn();
  release = undefined!;
  const navigating = platform.listener!({ type, ownerId: ownerA, tabId: 7, context: boundContext });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  platform.tab = { id: 8, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
  release(Response.json(boundSnapshot));
  expect(await navigating).toEqual({ ok: false, code: "source_changed" });
  expect(http.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  expect(platform.created).toEqual([]);
});

test("offline same-account context remains stale while queued learning retries the same command", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  await platform.listener!({ type: "LOAD_CONTEXT" });
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "LOAD_CONTEXT" })).toMatchObject({ stale: true, userId: ownerA, contexts: [{ ...boundContext }] });
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: boundContext })).toEqual({ ok: true, queued: true });
  const pending = structuredClone(platform.stored.blueprint_session_outbox_v1) as Array<{ ownerId: string; nodeId: string; resourceBindingId: string; clientMutationId: string }>;
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ ...boundContext, ownerId: ownerA, attempts: 0 });
  http.mockClear();
  http.mockResolvedValue(Response.json({ ok: true }));
  expect(await platform.listener!({ type: "RETRY_OUTBOX" })).toMatchObject({ recovered: 1, pending: 0 });
  const resent = http.mock.calls.find(([url]) => String(url).endsWith("/learning-sessions"));
  expect(JSON.parse(String(resent?.[1]?.body)).clientMutationId).toBe(pending[0]!.clientMutationId);
  expect(platform.stored.blueprint_session_outbox_v1).toEqual([]);
});

test("newly removed binding and unavailable uncached context cannot start learning", async () => {
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  await platform.listener!({ type: "LOAD_CONTEXT" });
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : snapshot));
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: boundContext })).toEqual({ ok: false, code: "source_changed" });
  delete platform.stored[`blueprint_cache:${ownerA}`];
  http.mockRejectedValue(new TypeError("offline"));
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: boundContext })).toEqual({ ok: false, code: "source_changed" });
  expect(http.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});

test("a late session response cannot queue old-account work after identity changes", async () => {
  let release!: (response: Response) => void;
  http.mockImplementation(async (url) => String(url).endsWith("/learning-sessions") ? new Promise((resolve) => { release = resolve; })
    : Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  const sending = platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: boundContext });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  signIn(ownerB);
  release(new Response(null, { status: 503 }));
  expect(await sending).toEqual({ ok: false, code: "superseded" });
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("multiple same-video bindings require and honor the explicitly selected binding", async () => {
  const multiple = structuredClone(boundSnapshot);
  const node = multiple.goals[0]!.stages[0]!.nodes[0]!;
  const otherContext = { nodeId: "018f6f68-9b4d-7c93-a134-c8571b8f7813", resourceBindingId: "018f6f68-9b4d-7c93-a134-c8571b8f7814" };
  multiple.goals[0]!.stages[0]!.nodes.push({ ...node, id: otherContext.nodeId, title: "另一个用途", position: 1,
    resources: [{ ...node.resources[0]!, id: otherContext.resourceBindingId }] });
  http.mockImplementation(async (url) => Response.json(String(url).endsWith("/account-preferences") ? eastern : multiple));
  expect((await platform.listener!({ type: "LOAD_CONTEXT" })).contexts).toHaveLength(2);
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7 })).toEqual({ ok: false, code: "source_changed" });
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: otherContext })).toEqual({ ok: true, queued: false });
  const sent = http.mock.calls.find(([url]) => String(url).endsWith("/learning-sessions"));
  expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject(otherContext);
});

test("LOAD_CONTEXT resolves the latest active video after a slow preference read", async () => {
  let release!: (response: Response) => void;
  http.mockImplementation(async (url) => String(url).endsWith("/account-preferences") ? new Promise((resolve) => { release = resolve; }) : Response.json(boundSnapshot));
  const loading = platform.listener!({ type: "LOAD_CONTEXT" });
  await vi.waitFor(() => expect(platform.stored[`blueprint_cache:${ownerA}`]).toBeDefined());
  platform.tab = { id: 8, url: "https://www.youtube.com/watch?v=abcdefghijk" };
  release(Response.json(eastern));
  expect(await loading).toMatchObject({ connected: true, tabId: 8, contexts: [] });
});

test("definitely rejected learning write never enters offline outbox", async () => {
  http.mockImplementation(async (url) => String(url).endsWith("/learning-sessions") ? Response.json({ code: "invalid" }, { status: 409 })
    : Response.json(String(url).endsWith("/account-preferences") ? eastern : boundSnapshot));
  expect(await platform.listener!({ type: "START_SESSION", ownerId: ownerA, tabId: 7, context: boundContext })).toEqual({ ok: false, code: "authorization_or_data_rejected" });
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("evidence workspace and writes are bound to the panel account through the real runtime", async () => {
  const input = { nodeId: ownerB, expectedVersion: 1, clientMutationId: "018f6f68-9b4d-7c93-a134-c8571b8f7803", text: "第一次实践", artifactUrl: null };
  const record = { id: ownerB, clientMutationId: input.clientMutationId,
    context: { blueprintId: ownerA, blueprintVersion: 1, goalId: ownerA, goalTitle: "目标", stageId: ownerA, stageTitle: "阶段", nodeId: ownerB, nodeTitle: "实践", nodeType: "practice" },
    text: input.text, artifactUrl: null, createdAt: "2026-09-10T00:00:00Z" };
  http.mockImplementation(async (url, options) => Response.json(String(url).endsWith("/progress-evidence") ? options?.method === "POST" ? record : [record] : snapshot));
  expect(await platform.listener!({ type: "LOAD_EVIDENCE", ownerId: ownerA })).toMatchObject({ ok: true, value: { blueprint: snapshot, records: { ok: true, value: [record] } } });
  expect(await platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input })).toEqual({ ok: true, value: record });
  const post = http.mock.calls.find(([, options]) => options?.method === "POST");
  expect(post?.[1]).toMatchObject({ headers: { Authorization: `Bearer token-${ownerA}`, "content-type": "application/json" }, credentials: "omit", cache: "no-store" });
  expect(JSON.parse(String(post?.[1]?.body))).toEqual(input);
  signIn(ownerB);
  http.mockClear();
  expect(await platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input })).toEqual({ ok: false, code: "forbidden" });
  expect(await platform.listener!({ type: "LOAD_EVIDENCE", ownerId: ownerA })).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
});

test("evidence uncertainty and definite rejection remain distinct without using the learning outbox", async () => {
  const input = { nodeId: ownerB, expectedVersion: 1, clientMutationId: "018f6f68-9b4d-7c93-a134-c8571b8f7803", text: "保留原提交", artifactUrl: null };
  const send = () => platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input });
  http.mockRejectedValue(new TypeError("response lost"));
  expect(await send()).toEqual({ ok: false, code: "unavailable" });
  http.mockResolvedValue(Response.json({ code: "invalid" }, { status: 503 }));
  expect(await send()).toEqual({ ok: false, code: "unavailable" });
  http.mockImplementation(async () => new Response("gateway HTML", { status: 409 }));
  expect(await send()).toEqual({ ok: false, code: "unavailable" });
  http.mockResolvedValue(Response.json({ code: "version_conflict" }, { status: 409 }));
  expect(await send()).toEqual({ ok: false, code: "version_conflict" });
  expect(platform.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
  http.mockClear();
  expect(await platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input: { ...input, artifactUrl: "javascript:alert(1)" } })).toEqual({ ok: false, code: "invalid" });
  expect(http).not.toHaveBeenCalled();
});

test("late evidence receipts and reads cannot escape after the owning session changes", async () => {
  const input = { nodeId: ownerB, expectedVersion: 1, clientMutationId: "018f6f68-9b4d-7c93-a134-c8571b8f7803", text: "私人内容" };
  let finish!: (response: Response) => void;
  http.mockImplementation(async () => new Promise((resolve) => { finish = resolve; }));
  const saving = platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  signIn(ownerB);
  finish(Response.json({ text: "不能显示给新账号" }));
  expect(await saving).toEqual({ ok: false, code: "forbidden" });
  signIn();
  http.mockImplementation(async (url) => String(url).endsWith("/blueprint") ? Response.json(snapshot) : new Promise((resolve) => { finish = resolve; }));
  finish = undefined!;
  const reading = platform.listener!({ type: "LOAD_EVIDENCE", ownerId: ownerA });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  signIn(ownerB);
  finish(Response.json([]));
  expect(await reading).toEqual({ ok: false, code: "forbidden" });
});

test("unavailable evidence history is not an empty feed and unauthorized reads invalidate only their token", async () => {
  http.mockImplementation(async (url) => String(url).endsWith("/blueprint") ? Response.json(snapshot) : new Response(null, { status: 503 }));
  expect(await platform.listener!({ type: "LOAD_EVIDENCE", ownerId: ownerA })).toEqual({ ok: true, value: { blueprint: snapshot, records: { ok: false, code: "unavailable" } } });
  http.mockResolvedValue(Response.json({ code: "unauthenticated" }, { status: 401 }));
  expect((await platform.listener!({ type: "LOAD_EVIDENCE", ownerId: ownerA })).ok).toBe(false);
  expect(await platform.listener!({ type: "AUTH_STATUS" })).toEqual({ connected: false });
});

test("a gateway 401 cannot erase the account or classify an uncertain evidence write as rejected", async () => {
  const input = { nodeId: ownerB, expectedVersion: 1, clientMutationId: "018f6f68-9b4d-7c93-a134-c8571b8f7803", text: "保留原提交" };
  for (const body of [null, "<html>upstream auth required</html>", JSON.stringify({ code: "invalid" })]) {
    http.mockImplementation(async () => new Response(body, { status: 401 }));
    expect(await platform.listener!({ type: "SAVE_EVIDENCE", ownerId: ownerA, input })).toEqual({ ok: false, code: "unavailable" });
    expect(await platform.listener!({ type: "AUTH_STATUS" })).toEqual({ connected: true, userId: ownerA });
  }
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
  expect(await context).toMatchObject({ connected: true, snapshot: boundSnapshot, contexts: [{ nodeTitle: "当前视频节点" }], preferences: cyberpunk });
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
