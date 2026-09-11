import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Sender = { id?: string; url?: string; tab?: { url?: string } };
const chrome = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, tab: { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk", pendingUrl: undefined as string | undefined },
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
const id = (n: number) => `fd860000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), runId = id(6), sender = { id: "test-extension", url: "chrome-extension://test-extension/sidepanel.html" };
const context = { bindingId: id(2), videoId: "abcdefghijk", sourceRunId: id(5), offset: 0, targetLanguage: "zh-Hans",
  selection: { start: { segmentIndex: 0, charOffset: 0 }, end: { segmentIndex: 0, charOffset: 6 } }, question: "如何实践这句话？" };
const message = { type: "LEARNING_EXPLANATION", ownerId: owner, expectedTabId: 7, nodeId: id(3), input: { operation: "start", context, runId } };
const page = { ownerId: owner, context: { bindingId: id(2), nodeId: id(3), nodeTitle: "节点", goalId: id(4), goalTitle: "目标", videoId: context.videoId },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: id(5), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
  contentExpiresAt: "2026-09-12T00:00:00Z", title: "原始标题", language: "en", offset: 0, totalSegments: 1,
  segments: [{ text: "Source must stay private.", offsetMs: 1200, durationMs: 300 }] };
const ack = { ok: true, runId, status: "ready" };
const view = { ok: true, run: { runId, accountId: owner, status: "ready", context: { bindingId: id(2), videoId: context.videoId, sourceRunId: id(5), offset: 0 },
  targetLanguage: "zh-Hans", observedAt: page.observedAt, contentExpiresAt: page.contentExpiresAt, selection: context.selection, question: context.question,
  result: { status: "explained", providerMayHaveRun: true, usage: null, answer: { kind: "explanation", meaning: "了解原文含义。", reasoning: "原文说明来源。",
    background: null, checkQuestion: "你会如何解释？", limitations: [], evidence: [{ segmentIndex: 0, quote: "Source" }] } } } };
const http = vi.fn<typeof fetch>();
function signIn(userId = owner) { chrome.stored.blueprint_cloud_session_v1 = { userId, accessToken: `token-${userId}`, refreshToken: "refresh", expiresAt: Date.now() + 3600_000 }; }
beforeEach(async () => {
  vi.resetModules(); chrome.stored = { blueprint_v3_cleanup_complete: true }; signIn(); http.mockReset();
  chrome.tab = { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk", pendingUrl: undefined };
  vi.stubEnv("WXT_PUBLIC_SUPABASE_URL", "https://auth.example.test"); vi.stubEnv("WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "extension-client");
  vi.stubEnv("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test"); vi.stubEnv("WXT_PUBLIC_WEB_ORIGIN", "https://blueprint.example.test");
  vi.stubGlobal("fetch", http); vi.stubGlobal("defineBackground", (initialize: () => void) => initialize());
  await import("../entrypoints/background");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function replies(result: unknown = ack) {
  http.mockImplementation(async url => Response.json(new URL(String(url)).pathname === "/api/v1/learning-transcript" ? page : result));
}

test("selected sidepanel explicitly starts a source-verified explanation without storing its private selection or question", async () => {
  replies();
  expect(await chrome.listener!(message, sender)).toEqual(ack);
  expect(http.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/api/v1/learning-transcript", "/api/v1/explanations/runs", "/api/v1/learning-transcript"]);
  expect(http.mock.calls[1]?.[1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer token-${owner}`, "content-type": "application/json" }, body: JSON.stringify({ accountId: owner, ...context, runId }) });
  expect(JSON.stringify(chrome.stored)).not.toMatch(/Source|如何实践|了解原文/);
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("a lookup cannot submit a question about characters outside the verified page", async () => {
  replies({ ok: true, run: null });
  expect(await chrome.listener!({ ...message, input: { operation: "find", context: { ...context,
    selection: { ...context.selection, end: { segmentIndex: 0, charOffset: 99 } } } } }, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(http.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/api/v1/learning-transcript"]);
});

test("find sends the exact question only in a POST body, while read and cancel never infer generation", async () => {
  for (const operation of ["find", "read", "cancel"]) {
    http.mockClear();
    http.mockImplementation(async (url, options) => Response.json(new URL(String(url)).pathname === "/api/v1/learning-transcript" ? page
      : operation === "cancel" && options?.method === "POST" ? { ...ack, status: "cancelled" } : view));
    expect(await chrome.listener!({ ...message, input: { operation, context, ...(operation === "find" ? {} : { runId }) } }, sender))
      .toEqual(operation === "cancel" ? { ...ack, status: "cancelled" } : view);
    const [url, options] = http.mock.calls[operation === "cancel" ? 2 : 1]!;
    expect(new URL(String(url)).pathname).toBe(`/api/v1/explanations/runs/${operation === "find" ? "find" : runId}`);
    expect(options?.method).toBe(operation === "read" ? "GET" : "POST");
    if (operation === "find") expect(JSON.parse(String(options?.body))).toEqual({ accountId: owner, ...context });
    if (operation === "cancel") expect(JSON.parse(String(options?.body))).toEqual({ accountId: owner, operation: "cancel" });
    expect(http.mock.calls.some(([requestUrl]) => String(requestUrl).includes(encodeURIComponent(context.question)) || String(requestUrl).includes(context.question))).toBe(false);
  }
  expect(JSON.stringify(chrome.stored)).not.toMatch(/Source|如何实践|了解原文/);
});

test("untrusted senders, open-ended commands and foreign owners cannot reach the explanation API", async () => {
  replies();
  for (const invalidSender of [undefined, {}, { ...sender, id: "other" }, { ...sender, url: chrome.tab.url }, { ...sender, tab: { url: chrome.tab.url } }])
    expect(await chrome.listener!(message, invalidSender)).toEqual({ ok: false, code: "forbidden" });
  for (const input of [{ ...message.input, url: "https://evil.test" }, { ...message.input, operation: "rpc" },
    { ...message.input, runId: "bad" }, { ...message.input, context: { ...context, offset: 1 } },
    { ...message.input, context: { ...context, transcript: "private" } }, { ...message.input, context: { ...context, question: "\ud800" } }])
    expect(await chrome.listener!({ ...message, input }, sender)).toEqual({ ok: false, code: "invalid" });
  expect(await chrome.listener!({ ...message, ownerId: id(99) }, sender)).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
  expect(await chrome.listener!({ ...message, nodeId: id(99) }, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(http.mock.calls.every(([url]) => new URL(String(url)).pathname === "/api/v1/learning-transcript")).toBe(true);
});

test.each(["account", "tab", "video", "pending video"])("late explanation replies after %s changes are discarded without retrying", async change => {
  let finish!: (response: Response) => void;
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page) : new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!(message, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  if (change === "account") signIn(id(99));
  if (change === "tab") chrome.tab.id = 8;
  if (change === "video") chrome.tab.url = "https://www.youtube.com/watch?v=zyxwvutsrqp";
  if (change === "pending video") chrome.tab.pendingUrl = "https://www.youtube.com/watch?v=zyxwvutsrqp";
  finish(Response.json(ack));
  expect(await pending).toEqual({ ok: false, code: change === "account" ? "forbidden" : "unavailable" });
  expect(http).toHaveBeenCalledTimes(2);
});

test.each(["question", "selection", "source", "account"])("read and cancellation cannot cross the current %s identity", async changed => {
  const run = { ...view.run, ...(changed === "question" ? { question: "另一个问题" } : {}),
    ...(changed === "selection" ? { selection: { ...context.selection, end: { segmentIndex: 0, charOffset: 7 } } } : {}),
    ...(changed === "source" ? { context: { ...view.run.context, sourceRunId: id(99) } } : {}),
    ...(changed === "account" ? { accountId: id(99) } : {}) };
  for (const operation of ["read", "cancel"]) {
    http.mockClear(); replies({ ok: true, run });
    expect(await chrome.listener!({ ...message, input: { operation, context, runId } }, sender)).toEqual({ ok: false, code: "unavailable" });
    expect(http.mock.calls.some(([url, options]) => String(url).includes("explanations") && options?.method === "POST")).toBe(false);
  }
});

test("source clearance or replacement during a response prevents its private result from reaching the panel", async () => {
  for (const change of ["clear", "text", "node"]) {
    let sourceReads = 0;
    http.mockImplementation(async url => {
      if (new URL(String(url)).pathname !== "/api/v1/learning-transcript") return Response.json(view);
      sourceReads++;
      if (sourceReads === 1) return Response.json(page);
      return Response.json(change === "clear" ? { ownerId: owner, context: page.context, observedAt: page.observedAt, status: "unavailable", reason: "cleared" }
        : change === "node" ? { ...page, context: { ...page.context, nodeId: id(99) } }
          : { ...page, segments: [{ ...page.segments[0], text: "Source has changed." }] });
    });
    expect(await chrome.listener!({ ...message, input: { operation: "read", context, runId } }, sender)).toEqual({ ok: false, code: "unavailable" });
  }
});

test("a cleared run remains a bodyless tombstone when its source is unavailable", async () => {
  const tombstone = { ok: true, run: { ...view.run, status: "cleared", selection: null, question: null, observedAt: null, result: null } };
  http.mockImplementation(async url => Response.json(new URL(String(url)).pathname === "/api/v1/learning-transcript"
    ? { ownerId: owner, context: page.context, observedAt: page.observedAt, status: "unavailable", reason: "cleared" } : tombstone));
  expect(await chrome.listener!({ ...message, input: { operation: "read", context, runId } }, sender)).toEqual(tombstone);
  http.mockImplementation(async url => Response.json(new URL(String(url)).pathname === "/api/v1/learning-transcript" ? page
    : { ...tombstone, run: { ...tombstone.run, question: context.question } }));
  expect(await chrome.listener!({ ...message, input: { operation: "read", context, runId } }, sender)).toEqual({ ok: false, code: "unavailable" });
});

test("the read deadline covers source verification and cannot initiate an explanation after returning", async () => {
  vi.useFakeTimers();
  let release!: (response: Response) => void;
  http.mockImplementation(async () => new Promise(resolve => { release = resolve; }));
  const pending = chrome.listener!({ ...message, input: { operation: "read", context, runId } }, sender);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await pending).toEqual({ ok: false, code: "unavailable" });
  release(Response.json(page)); await vi.advanceTimersByTimeAsync(1);
  expect(http).toHaveBeenCalledTimes(1);
});

test("malformed private projections and non-application gateway 401 replies never expose content or disconnect the account", async () => {
  for (const result of [{ ...ack, runId: id(99) }, { ...ack, secret: "private" }]) {
    replies(result); expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  for (const run of [{ ...view.run, input_page: page }, { ...view.run, observedAt: null },
    { ...view.run, result: { ...view.run.result, answer: { ...view.run.result.answer, evidence: [{ segmentIndex: 0, quote: "Fabricated quote" }] } } }]) {
    replies({ ok: true, run });
    expect(await chrome.listener!({ ...message, input: { operation: "read", context, runId } }, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page) : Response.json({ error: "gateway" }, { status: 401 }));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(await chrome.listener!({ type: "AUTH_STATUS" }, sender)).toEqual({ connected: true, userId: owner });
});

test.each(["oversize", "invalid UTF-8", "non-JSON"])("%s replies are bounded, released and never treated as a completed attempt", async kind => {
  const cancel = vi.fn();
  http.mockImplementation(async url => {
    if (new URL(String(url)).pathname === "/api/v1/learning-transcript") return Response.json(page);
    return new Response(new ReadableStream({ start(controller) {
      if (kind === "oversize") controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      if (kind === "invalid UTF-8") controller.enqueue(new Uint8Array([0xc3, 0x28]));
    }, cancel }), { headers: { "content-type": kind === "non-JSON" ? "text/html" : "application/json" } });
  });
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(http).toHaveBeenCalledTimes(2);
});

test("a source lifetime consumed in flight cannot be renewed by a later observedAt response", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let finish!: (response: Response) => void;
  const expiring = { ...page, contentExpiresAt: "2026-09-11T00:00:00.100Z" };
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(expiring)
    : new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!(message, sender);
  await vi.advanceTimersByTimeAsync(1);
  expect(finish).toBeTypeOf("function");
  await vi.advanceTimersByTimeAsync(150);
  finish(Response.json(ack));
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({ ok: false, code: "unavailable" });
});

test("only the exact disabled start response can tell the panel that generation never began", async () => {
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page)
    : Response.json({ ok: false, code: "disabled" }, { status: 503 }));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "disabled" });
  expect(http).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(chrome.stored)).not.toMatch(/Source|如何实践|了解原文/);
});

test("non-start, non-503, expanded or malformed disabled responses remain uncertain", async () => {
  const cases = [
    { operation: "start", status: 502, body: { ok: false, code: "disabled" } },
    { operation: "start", status: 200, body: { ok: false, code: "disabled" } },
    { operation: "start", status: 503, body: { ok: false, code: "disabled", error: "gateway detail" } },
    { operation: "start", status: 503, body: { code: "disabled" } },
    { operation: "start", status: 503, body: { ok: true, code: "disabled" } },
    { operation: "read", status: 503, body: { ok: false, code: "disabled" } },
    { operation: "find", status: 503, body: { ok: false, code: "disabled" } },
    { operation: "cancel", status: 503, body: { ok: false, code: "disabled" } },
  ];
  for (const item of cases) {
    http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page)
      : Response.json(item.body, { status: item.status }));
    expect(await chrome.listener!({ ...message, input: { operation: item.operation, context, ...(item.operation === "find" ? {} : { runId }) } }, sender))
      .toEqual({ ok: false, code: "unavailable" });
  }
});

test.each(["account", "tab"])("a disabled reply arriving after the %s changes cannot reset the old attempt", async change => {
  let finish!: (response: Response) => void;
  http.mockImplementation(async url => new URL(String(url)).pathname === "/api/v1/learning-transcript" ? Response.json(page)
    : new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!(message, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  if (change === "account") signIn(id(99)); else chrome.tab.id = 8;
  finish(Response.json({ ok: false, code: "disabled" }, { status: 503 }));
  expect(await pending).toEqual({ ok: false, code: change === "account" ? "forbidden" : "unavailable" });
});
