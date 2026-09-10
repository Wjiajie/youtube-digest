// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=abcdefghijk"}
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Message = { type: string; ownerId?: string; input?: unknown; videoId?: string };
type Sender = { id?: string; url?: string; tab?: { id: number; url?: string } };
type Listener = (message: Message, sender?: Sender) => unknown;
const fixture = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, listeners: [] as Listener[], query: vi.fn(), sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { id: "blueprint-test", getURL: (path: string) => `chrome-extension://blueprint-test/${path.replace(/^\//, "")}`, onMessage: { addListener: (listener: Listener) => fixture.listeners.push(listener) } },
  tabs: { query: fixture.query, sendMessage: fixture.sendMessage },
  storage: { local: {
    get: async (key: string | null) => key ? { [key]: fixture.stored[key] } : { ...fixture.stored },
    set: async (values: Record<string, unknown>) => { Object.assign(fixture.stored, values); },
    remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete fixture.stored[key]; },
  } },
} }));
const owner = "fd530000-0000-4000-8000-000000000001";
const sidepanel = { id: "blueprint-test", url: "chrome-extension://blueprint-test/sidepanel.html" };
const message = { type: "READ_NOTE_POSITION", ownerId: owner, input: { videoId: "abcdefghijk" } };
let background: Listener;
beforeEach(async () => {
  vi.resetModules(); fixture.listeners = []; fixture.query.mockReset(); fixture.sendMessage.mockReset();
  fixture.stored = { blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: { userId: owner, accessToken: "test-token", refreshToken: "test-refresh", expiresAt: Date.now() + 3600_000 } };
  fixture.query.mockResolvedValue([{ id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk" }]);
  vi.stubEnv("WXT_PUBLIC_SUPABASE_URL", "https://auth.example.test"); vi.stubEnv("WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "extension-client");
  vi.stubEnv("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test");
  vi.stubGlobal("defineBackground", (initialize: () => void) => initialize());
  await import("../entrypoints/background"); background = fixture.listeners[0]!;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); document.body.replaceChildren(); });

test("own sidepanel explicitly reads the matching active player's integer position without passing private data", async () => {
  fixture.sendMessage.mockResolvedValue({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 0 } });
  expect(await background(message, sidepanel)).toEqual({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 0 } });
  expect(fixture.sendMessage).toHaveBeenCalledExactlyOnceWith(7, { type: "BLUEPRINT_READ_PLAYER_POSITION", videoId: "abcdefghijk" }, { frameId: 0 });
  expect(fixture.query).toHaveBeenCalledTimes(2);
});
test("the exact own sidepanel document is authorized when Chrome hosts it in an extension tab", async () => {
  fixture.sendMessage.mockResolvedValue({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 12 } });
  expect(await background(message, { ...sidepanel, tab: { id: 9, url: sidepanel.url } })).toEqual({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 12 } });
});
test("only the authenticated owner's own sidepanel can request a position", async () => {
  for (const sender of [undefined, { ...sidepanel, tab: { id: 7 } }, { ...sidepanel, tab: { id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk" } }, { ...sidepanel, id: "another-extension" }, { ...sidepanel, url: "https://www.youtube.com/watch?v=abcdefghijk" }, { ...sidepanel, url: `${sidepanel.url}?x=1` }])
    expect(await background(message, sender)).toEqual({ ok: false, code: "forbidden" });
  expect(await background({ ...message, ownerId: "other-owner" }, sidepanel)).toEqual({ ok: false, code: "forbidden" });
  delete fixture.stored.blueprint_cloud_session_v1;
  expect(await background(message, sidepanel)).toEqual({ ok: false, code: "unauthenticated" });
  expect(fixture.query).not.toHaveBeenCalled(); expect(fixture.sendMessage).not.toHaveBeenCalled();
});
test("invalid source and non-watch or mismatched active tabs never query the player", async () => {
  for (const input of [null, {}, { videoId: "short" }, { videoId: "abcdefghijk", text: "private" }])
    expect(await background({ ...message, input }, sidepanel)).toEqual({ ok: false, code: "invalid" });
  for (const url of ["https://www.youtube.com/shorts/abcdefghijk", "https://www.youtube.com/watch?v=12345678901", "https://evil.test/watch?v=abcdefghijk", "https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk"]) {
    fixture.query.mockResolvedValue([{ id: 7, url }]);
    expect(await background(message, sidepanel)).toEqual({ ok: false, code: "unavailable" });
  }
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});
test("untrusted content replies cannot return another video or an invalid time", async () => {
  for (const reply of [undefined, { ok: false, code: "unavailable" }, { ok: true, value: { videoId: "12345678901", positionSeconds: 1 } },
    ...[-1, 1.5, Infinity, NaN, 2147483648, "1"].map(positionSeconds => ({ ok: true, value: { videoId: "abcdefghijk", positionSeconds } })),
    { ok: true, value: { videoId: "abcdefghijk", positionSeconds: 1, extra: true } }, { ok: true, value: { videoId: "abcdefghijk", positionSeconds: 1 }, extra: true }]) {
    fixture.sendMessage.mockResolvedValue(reply);
    expect(await background(message, sidepanel)).toEqual({ ok: false, code: "unavailable" });
  }
});
test("account, active tab or video changes during a read invalidate the old result", async () => {
  const receipt = { ok: true, value: { videoId: "abcdefghijk", positionSeconds: 75 } };
  fixture.sendMessage.mockImplementation(async () => { delete fixture.stored.blueprint_cloud_session_v1; return receipt; });
  expect(await background(message, sidepanel)).toEqual({ ok: false, code: "forbidden" });
  fixture.stored.blueprint_cloud_session_v1 = { userId: owner, accessToken: "new-token", refreshToken: "refresh", expiresAt: Date.now() + 3600_000 };
  for (const after of [{ id: 8, url: "https://www.youtube.com/watch?v=abcdefghijk" }, { id: 7, url: "https://www.youtube.com/watch?v=12345678901" }]) {
    fixture.query.mockResolvedValueOnce([{ id: 7, url: "https://www.youtube.com/watch?v=abcdefghijk" }]).mockResolvedValueOnce([after]);
    fixture.sendMessage.mockResolvedValue(receipt);
    expect(await background(message, sidepanel)).toEqual({ ok: false, code: "unavailable" });
  }
});
test("missing content and a stalled content read fail once within the bounded timeout", async () => {
  fixture.sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist"));
  expect(await background(message, sidepanel)).toEqual({ ok: false, code: "unavailable" });
  vi.useFakeTimers(); fixture.sendMessage.mockClear(); fixture.sendMessage.mockImplementation(() => new Promise(() => undefined));
  const pending = background(message, sidepanel);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toEqual({ ok: false, code: "unavailable" }); expect(fixture.sendMessage).toHaveBeenCalledTimes(1);
});
