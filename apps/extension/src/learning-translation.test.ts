import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Sender = { id?: string; url?: string; tab?: { url?: string } };
const chrome = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, tab: { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk" },
  listener: null as null | ((message: unknown, sender?: Sender) => Promise<unknown>) }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { id: "test-extension", getURL: (path: string) => `chrome-extension://test-extension${path}`, onMessage: { addListener: (listener: typeof chrome.listener) => { chrome.listener = listener; } } },
  tabs: { query: async () => [chrome.tab] },
  storage: { local: {
    get: async (key: string | null) => key ? { [key]: chrome.stored[key] } : { ...chrome.stored },
    set: async (values: Record<string, unknown>) => { Object.assign(chrome.stored, structuredClone(values)); },
    remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete chrome.stored[key]; },
  } },
} }));
const id = (n: number) => `fd810000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), runId = id(6), sender = { id: "test-extension", url: "chrome-extension://test-extension/sidepanel.html" };
const input = { bindingId: id(2), videoId: "abcdefghijk", sourceRunId: id(5), offset: 0, targetLanguage: "zh-Hans" };
const message = { type: "LEARNING_TRANSLATION", ownerId: owner, expectedTabId: 7, nodeId: id(3), input: { operation: "start", context: input, runId } };
const page = { ownerId: owner, context: { bindingId: id(2), nodeId: id(3), nodeTitle: "节点", goalId: id(4), goalTitle: "目标", videoId: input.videoId },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: id(5), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
  contentExpiresAt: "2026-09-12T00:00:00Z", title: "原始标题", language: "en", offset: 0, totalSegments: 1,
  segments: [{ text: "Source must stay private.", offsetMs: 1200, durationMs: 300 }] };
const ack = { ok: true, runId, status: "ready" };
const view = { ok: true, run: { runId, accountId: owner, status: "ready", context: { bindingId: id(2), videoId: input.videoId, sourceRunId: id(5), offset: 0 },
  targetLanguage: "zh-Hans", observedAt: page.observedAt, contentExpiresAt: page.contentExpiresAt,
  result: { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 0, translation: "译文保持私密。" }] } } };
const http = vi.fn<typeof fetch>();
function signIn(userId = owner) { chrome.stored.blueprint_cloud_session_v1 = { userId, accessToken: `token-${userId}`, refreshToken: "refresh", expiresAt: Date.now() + 3600_000 }; }
beforeEach(async () => {
  vi.resetModules(); chrome.stored = { blueprint_v3_cleanup_complete: true }; signIn(); http.mockReset();
  chrome.tab = { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk" };
  vi.stubEnv("WXT_PUBLIC_SUPABASE_URL", "https://auth.example.test"); vi.stubEnv("WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "extension-client");
  vi.stubEnv("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test"); vi.stubEnv("WXT_PUBLIC_WEB_ORIGIN", "https://blueprint.example.test");
  vi.stubGlobal("fetch", http); vi.stubGlobal("defineBackground", (initialize: () => void) => initialize());
  await import("../entrypoints/background");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function replies(result: unknown = ack) {
  http.mockImplementation(async (url, options) => Response.json(new URL(String(url)).pathname === "/api/v1/learning-transcript" ? page
    : options?.method === "GET" && typeof result === "object" && result !== null && "status" in result && result.status === "cancelled" ? view : result));
}

test("selected sidepanel explicitly starts one cloud translation with verified source context, no stored body or silent retry", async () => {
  replies();
  expect(await chrome.listener!(message, sender)).toEqual(ack);
  expect(http.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/api/v1/learning-transcript", "/api/v1/translations/runs"]);
  expect(http.mock.calls[1]?.[1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer token-${owner}`, "content-type": "application/json" }, body: JSON.stringify({ accountId: owner, ...input, runId }) });
  expect(JSON.stringify(chrome.stored)).not.toContain("Source must stay private");
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("find/read/cancel use their exact cloud operations and never infer a generation request", async () => {
  for (const operation of ["find", "read", "cancel"]) {
    http.mockClear(); replies(operation === "cancel" ? { ...ack, status: "cancelled" } : view);
    const inputCommand = { operation, context: input, ...(operation === "find" ? {} : { runId }) };
    expect(await chrome.listener!({ ...message, input: inputCommand }, sender)).toEqual(operation === "cancel" ? { ...ack, status: "cancelled" } : view);
    const [url, options] = http.mock.calls[operation === "cancel" ? 2 : 1]!;
    expect(new URL(String(url)).pathname).toBe(`/api/v1/translations/runs${operation === "find" ? "" : `/${runId}`}`);
    expect(options?.method).toBe(operation === "cancel" ? "POST" : "GET");
    if (operation === "cancel") expect(JSON.parse(String(options?.body))).toEqual({ accountId: owner, operation: "cancel" });
  }
  expect(JSON.stringify(chrome.stored)).not.toContain("译文保持私密");
});

test("untrusted senders, malformed commands, foreign owners and mismatched selected nodes cannot start a translation", async () => {
  replies();
  for (const invalidSender of [undefined, {}, { ...sender, id: "other" }, { ...sender, url: "https://www.youtube.com/watch?v=abcdefghijk" }])
    expect(await chrome.listener!(message, invalidSender)).toEqual({ ok: false, code: "forbidden" });
  for (const invalidInput of [{ ...message.input, url: "https://evil.test" }, { ...message.input, operation: "rpc" },
    { ...message.input, runId: "bad" }, { ...message.input, context: { ...input, offset: 1 } }, { ...message.input, context: { ...input, transcript: "private" } }])
    expect(await chrome.listener!({ ...message, input: invalidInput }, sender)).toEqual({ ok: false, code: "invalid" });
  expect(await chrome.listener!({ ...message, ownerId: id(9) }, sender)).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
  expect(await chrome.listener!({ ...message, nodeId: id(9) }, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(http.mock.calls.every(([url]) => new URL(String(url)).pathname === "/api/v1/learning-transcript")).toBe(true);
});

test.each(["account", "tab", "video"])("late translation replies after %s changes are discarded without persisting or repeating work", async change => {
  let finish!: (response: Response) => void;
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page) : new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!(message, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  if (change === "account") signIn(id(9));
  if (change === "tab") chrome.tab = { ...chrome.tab, id: 8 };
  if (change === "video") chrome.tab = { ...chrome.tab, url: "https://www.youtube.com/watch?v=zyxwvutsrqp" };
  finish(Response.json(ack));
  expect(await pending).toEqual({ ok: false, code: change === "account" ? "forbidden" : "unavailable" });
  expect(http).toHaveBeenCalledTimes(2);
});

test("foreign or private response fields are refused and gateway 401 does not disconnect the account", async () => {
  for (const result of [{ ...ack, runId: id(9) }, { ...ack, skill: "private" }]) {
    replies(result); expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  for (const result of [{ ok: true, run: { ...view.run, accountId: id(9) } }, { ok: true, run: { ...view.run, input_page: page } },
    { ok: true, run: { ...view.run, context: { ...view.run.context, sourceRunId: id(9) } } }]) {
    replies(result); expect(await chrome.listener!({ ...message, input: { ...message.input, operation: "read" } }, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page) : Response.json({ error: "gateway" }, { status: 401 }));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(await chrome.listener!({ type: "AUTH_STATUS" }, sender)).toEqual({ connected: true, userId: owner });
});

test("the ten-second read deadline includes source verification and cannot trigger a later translation operation", async () => {
  vi.useFakeTimers();
  let release!: (response: Response) => void;
  http.mockImplementation(async () => new Promise(resolve => { release = resolve; }));
  const pending = chrome.listener!({ ...message, input: { ...message.input, operation: "read" } }, sender);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await Promise.race([pending, Promise.resolve("still waiting")])).toEqual({ ok: false, code: "unavailable" });
  release(Response.json(page)); await vi.advanceTimersByTimeAsync(1);
  expect(http).toHaveBeenCalledTimes(1);
});

test("rejecting a streaming non-JSON gateway response releases its body", async () => {
  const cancel = vi.fn();
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page)
    : new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/html" } }));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("cancellation cannot mix the selected page with another same-account translation", async () => {
  http.mockImplementation(async (url, options) => {
    if (new URL(String(url)).pathname === "/api/v1/learning-transcript") return Response.json(page);
    if (options?.method === "GET") return Response.json({ ok: true, run: { ...view.run, context: { ...view.run.context, bindingId: id(99) } } });
    return Response.json({ ...ack, status: "cancelled" });
  });
  expect(await chrome.listener!({ ...message, input: { ...message.input, operation: "cancel" } }, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(http.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
