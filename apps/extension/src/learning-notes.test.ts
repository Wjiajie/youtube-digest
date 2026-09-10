import { afterEach, beforeEach, expect, test, vi } from "vitest";

const chrome = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, listener: null as null | ((message: { type: string; ownerId?: string; input?: unknown }) => Promise<unknown>) }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { onMessage: { addListener: (listener: typeof chrome.listener) => { chrome.listener = listener; } } },
  storage: { local: {
    get: async (key: string | null) => key ? { [key]: chrome.stored[key] } : { ...chrome.stored },
    set: async (values: Record<string, unknown>) => { Object.assign(chrome.stored, structuredClone(values)); },
    remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete chrome.stored[key]; },
  } },
} }));
const owner = "fd520000-0000-4000-8000-000000000001", other = "fd520000-0000-4000-8000-000000000002";
const blueprint = { schemaVersion: 2, id: "fd520000-0000-4000-8000-000000000003", version: 2, title: "私人路径", goals: [] };
const command = { nodeId: "fd520000-0000-4000-8000-000000000004", resourceBindingId: "fd520000-0000-4000-8000-000000000005", expectedVersion: 1,
  clientMutationId: "fd520000-0000-4000-8000-000000000006", text: "  私人笔记\n😀  ", positionSeconds: 75 };
const note = { id: "fd520000-0000-4000-8000-000000000007", clientMutationId: command.clientMutationId,
  context: { blueprintId: blueprint.id, blueprintVersion: 1, goalId: "fd520000-0000-4000-8000-000000000008", goalTitle: "旧目标", stageId: "fd520000-0000-4000-8000-000000000009", stageTitle: "旧阶段",
    nodeId: command.nodeId, nodeTitle: "已移除节点", nodeType: "learn" },
  resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  text: command.text, positionSeconds: 75, createdAt: "2026-09-10T00:00:00Z" };
const workspace = { blueprint, records: [note] };
const http = vi.fn<typeof fetch>();
function signIn(userId = owner) { chrome.stored.blueprint_cloud_session_v1 = { userId, accessToken: `token-${userId}`, refreshToken: "refresh", expiresAt: Date.now() + 3600_000 }; }
beforeEach(async () => {
  vi.resetModules(); chrome.stored = { blueprint_v3_cleanup_complete: true }; signIn(); http.mockReset();
  vi.stubEnv("WXT_PUBLIC_SUPABASE_URL", "https://auth.example.test"); vi.stubEnv("WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "extension-client");
  vi.stubEnv("WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test"); vi.stubEnv("WXT_PUBLIC_WEB_ORIGIN", "https://blueprint.example.test");
  vi.stubGlobal("fetch", http); vi.stubGlobal("defineBackground", (initialize: () => void) => initialize());
  await import("../entrypoints/background");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("explicit notes read uses real account authentication and the bare historical workspace without auto writes", async () => {
  http.mockImplementation(async () => Response.json(workspace));
  expect(await chrome.listener!({ type: "LOAD_LEARNING_NOTES", ownerId: owner })).toEqual({ ok: true, value: workspace });
  expect(http).toHaveBeenCalledExactlyOnceWith("https://blueprint.example.test/api/v1/learning-notes", expect.objectContaining({ method: "GET", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer token-${owner}`, "content-type": "application/json" } }));
});
test("explicit note replay preserves the original command after its binding has disappeared", async () => {
  http.mockImplementation(async () => Response.json(note));
  expect(await chrome.listener!({ type: "SAVE_LEARNING_NOTE", ownerId: owner, input: command })).toEqual({ ok: true, value: note });
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]![1]?.method).toBe("POST");
  expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual(command);
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});
test("notes fail closed for malformed, foreign, future or duplicated history rather than pretending it is empty", async () => {
  for (const value of [
    { ok: true, value: workspace }, { ...workspace, records: null }, { ...workspace, extra: true },
    { ...workspace, blueprint: { ...blueprint, schemaVersion: 1 } },
    { ...workspace, records: [note, note] }, { ...workspace, records: Array.from({ length: 51 }, () => note) },
    { ...workspace, records: [{ ...note, context: { ...note.context, blueprintId: other } }] },
    { ...workspace, records: [{ ...note, context: { ...note.context, blueprintVersion: 3 } }] },
    { ...workspace, records: [{ ...note, resource: { ...note.resource, url: "javascript:alert(1)" } }] },
    { ...workspace, records: [{ ...note, context: { ...note.context, extra: true } }] },
  ]) {
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!({ type: "LOAD_LEARNING_NOTES", ownerId: owner })).toEqual({ ok: false, code: "unavailable" });
  }
});
test("note receipts must match every command field exactly and invalid commands never reach HTTP", async () => {
  for (const value of [
    { ...note, clientMutationId: other }, { ...note, context: { ...note.context, nodeId: other } },
    { ...note, context: { ...note.context, blueprintVersion: 2 } }, { ...note, resource: { ...note.resource, bindingId: other } },
    { ...note, text: command.text.trim() }, { ...note, positionSeconds: null },
  ]) {
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!({ type: "SAVE_LEARNING_NOTE", ownerId: owner, input: command })).toEqual({ ok: false, code: "unavailable" });
  }
  http.mockClear();
  for (const input of [{ ...command, positionSeconds: -1 }, { ...command, text: "\ufeff\n" }, { ...command, text: "\u0000" }, { ...command, unknown: true }])
    expect(await chrome.listener!({ type: "SAVE_LEARNING_NOTE", ownerId: owner, input })).toEqual({ ok: false, code: "invalid" });
  expect(http).not.toHaveBeenCalled();
});
test.each(["LOAD_LEARNING_NOTES", "SAVE_LEARNING_NOTE"])("%s isolates old-account and late receipts through real auth", async (type) => {
  expect(await chrome.listener!({ type, ownerId: other, input: command })).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
  let finish!: (value: Response) => void;
  http.mockImplementation(async () => new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!({ type, ownerId: owner, input: command });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  signIn(other); finish(Response.json(type === "LOAD_LEARNING_NOTES" ? workspace : note));
  expect(await pending).toEqual({ ok: false, code: "forbidden" });
});
test("uncertain note saves never auto retry; manual retry uses the same mutation and generic 401 does not logout", async () => {
  const send = () => chrome.listener!({ type: "SAVE_LEARNING_NOTE", ownerId: owner, input: command });
  http.mockRejectedValueOnce(new TypeError("lost receipt"));
  expect(await send()).toEqual({ ok: false, code: "unavailable" }); expect(http).toHaveBeenCalledTimes(1);
  http.mockImplementation(async () => Response.json(note));
  expect(await send()).toEqual({ ok: true, value: note });
  expect(http.mock.calls.map(([,options]) => JSON.parse(String(options?.body)))).toEqual([command, command]);
  http.mockImplementation(async () => new Response("gateway", { status: 401 }));
  expect(await send()).toEqual({ ok: false, code: "unavailable" });
  expect(await chrome.listener!({ type: "AUTH_STATUS" })).toEqual({ connected: true, userId: owner });
  http.mockImplementation(async () => Response.json({ code: "version_conflict" }, { status: 409 }));
  expect(await send()).toEqual({ ok: false, code: "version_conflict" });
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});
