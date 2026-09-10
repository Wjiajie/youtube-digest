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
const id = (n: number) => `fd680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), sender = { id: "test-extension", url: "chrome-extension://test-extension/sidepanel.html" };
const input = { bindingId: id(2), videoId: "abcdefghijk", sourceRunId: null, offset: 0 };
const message = { type: "LOAD_LEARNING_TRANSCRIPT", ownerId: owner, expectedTabId: 7, nodeId: id(3), input };
const page = { ownerId: owner, context: { bindingId: id(2), nodeId: id(3), nodeTitle: "节点", goalId: id(4), goalTitle: "目标", videoId: input.videoId },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: id(5), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
  contentExpiresAt: "2026-09-12T00:00:00Z", title: "原始标题", language: "zh", offset: 0, totalSegments: 1,
  segments: [{ text: "原文 <script> 逐字保留", offsetMs: 1200.5, durationMs: 300 }] };
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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("the selected sidepanel video reads only one authenticated transcript page without storing its body", async () => {
  http.mockResolvedValue(Response.json(page));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: true, value: page });
  expect(http).toHaveBeenCalledExactlyOnceWith(`https://blueprint.example.test/api/v1/learning-transcript?bindingId=${id(2)}&videoId=abcdefghijk&offset=0`,
    expect.objectContaining({ method: "GET", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer token-${owner}`, "content-type": "application/json" } }));
  expect(JSON.stringify(chrome.stored)).not.toContain("逐字保留");
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});

test("only the extension sidepanel and its currently selected watch tab may read transcripts", async () => {
  for (const invalidSender of [undefined, {}, { ...sender, id: "another-extension" }, { ...sender, url: "https://www.youtube.com/watch?v=abcdefghijk" }, { ...sender, tab: { url: "https://www.youtube.com/watch?v=abcdefghijk" } }])
    expect(await chrome.listener!(message, invalidSender)).toEqual({ ok: false, code: "forbidden" });
  for (const tab of [{ id: 8, url: chrome.tab.url }, { id: 7, url: "https://www.youtube.com/watch?v=lmnopqrstuv" },
    { id: 7, url: "https://evil.test/watch?v=abcdefghijk" }, { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv" }]) {
    chrome.tab = tab;
    expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  expect(http).not.toHaveBeenCalled();
});

test("invalid commands and a different owner never reach the transcript endpoint", async () => {
  for (const invalidInput of [{ ...input, bindingId: "invalid" }, { ...input, offset: 20 }, { ...input, offset: -20 },
    { ...input, sourceRunId: id(5), offset: 1 }, { ...input, videoId: "javascript:" }, { ...input, extra: "private" }])
    expect(await chrome.listener!({ ...message, input: invalidInput }, sender)).toEqual({ ok: false, code: "invalid" });
  expect(await chrome.listener!({ ...message, expectedTabId: undefined }, sender)).toEqual({ ok: false, code: "invalid" });
  expect(await chrome.listener!({ ...message, nodeId: null }, sender)).toEqual({ ok: false, code: "invalid" });
  expect(await chrome.listener!({ ...message, ownerId: id(9) }, sender)).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
});

test("paging pins the exact source and rejects a different owner, node, binding, video or source body", async () => {
  const command = { ...input, bindingId: input.bindingId.toUpperCase(), sourceRunId: id(5).toUpperCase(), offset: 20 };
  const next = { ...page, offset: 20, totalSegments: 21 };
  http.mockImplementation(async () => Response.json(next));
  expect(await chrome.listener!({ ...message, input: command }, sender)).toEqual({ ok: true, value: next });
  expect(http.mock.calls[0]![0]).toBe(`https://blueprint.example.test/api/v1/learning-transcript?bindingId=${id(2)}&videoId=abcdefghijk&offset=20&sourceRunId=${id(5)}`);
  for (const value of [{ ...next, ownerId: id(9) }, { ...next, context: { ...next.context, nodeId: id(9) } },
    { ...next, context: { ...next.context, bindingId: id(9) } }, { ...next, context: { ...next.context, videoId: "lmnopqrstuv" } },
    { ...next, sourceRunId: id(9) }, { ...next, offset: 0 }, { ...next, skill: "PRIVATE_SKILL" },
    { ...next, segments: [] }, { ...next, contentExpiresAt: next.observedAt }]) {
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!({ ...message, input: command }, sender)).toEqual({ ok: false, code: "unavailable" });
  }
});

test.each(["account", "tab", "video"])("late transcript replies are discarded after %s changes", async change => {
  let finish!: (response: Response) => void;
  http.mockImplementation(async () => new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!(message, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  if (change === "account") signIn(id(9));
  if (change === "tab") chrome.tab = { ...chrome.tab, id: 8 };
  if (change === "video") chrome.tab = { ...chrome.tab, url: "https://www.youtube.com/watch?v=lmnopqrstuv" };
  finish(Response.json(page));
  expect(await pending).toEqual({ ok: false, code: change === "account" ? "forbidden" : "unavailable" });
  expect(JSON.stringify(chrome.stored)).not.toContain("逐字保留");
});

test("pending, expired and cleared material stays body-free and gateway errors do not disconnect", async () => {
  for (const reason of ["not_acquired", "pending", "not_available", "expired", "cleared"]) {
    const value = { ownerId: owner, context: page.context, observedAt: page.observedAt, status: "unavailable", reason };
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!(message, sender)).toEqual({ ok: true, value });
  }
  for (const status of [401, 403, 404, 409, 422, 503]) {
    http.mockImplementation(async () => Response.json({ error: "gateway" }, { status }));
    expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "unavailable" });
  }
  expect(await chrome.listener!({ type: "AUTH_STATUS" }, sender)).toEqual({ connected: true, userId: owner });
  http.mockImplementation(async () => Response.json({ code: "not_found" }, { status: 404 }));
  expect(await chrome.listener!(message, sender)).toEqual({ ok: false, code: "not_found" });
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});
