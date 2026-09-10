import { afterEach, beforeEach, expect, test, vi } from "vitest";

const chrome = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, listener: null as null | ((message: { type: string; ownerId?: string; input?: unknown; resourceBindingId?: unknown }) => Promise<unknown>) }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { onMessage: { addListener: (listener: typeof chrome.listener) => { chrome.listener = listener; } } },
  storage: { local: {
    get: async (key: string | null) => key ? { [key]: chrome.stored[key] } : { ...chrome.stored },
    set: async (values: Record<string, unknown>) => { Object.assign(chrome.stored, structuredClone(values)); },
    remove: async (keys: string | string[]) => { for (const key of [keys].flat()) delete chrome.stored[key]; },
  } },
} }));
const id = (n: number) => `fd580000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), other = id(2);
const blueprint = { schemaVersion: 2, id: id(3), version: 2, title: "私人路径", goals: [] };
const command = { nodeId: id(4), resourceBindingId: id(5), expectedVersion: 1, expectedPositionVersion: 2, clientMutationId: id(6), positionSeconds: 0 };
const position = { id: id(7), clientMutationId: command.clientMutationId,
  context: { blueprintId: blueprint.id, blueprintVersion: 1, goalId: id(8), goalTitle: "旧目标", stageId: id(9), stageTitle: "旧阶段",
    nodeId: command.nodeId, nodeTitle: "已移除节点", nodeType: "learn" },
  resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  positionSeconds: 0, expectedPositionVersion: 2, positionVersion: 3, createdAt: "2026-09-10T00:00:00Z" };
const workspace = { blueprint, records: [position] };
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
test("explicit position workspace read preserves historical sources with no automatic save", async () => {
  http.mockImplementation(async () => Response.json(workspace));
  expect(await chrome.listener!({ type: "LOAD_LEARNING_POSITIONS", ownerId: owner })).toEqual({ ok: true, value: workspace });
  expect(http).toHaveBeenCalledExactlyOnceWith("https://blueprint.example.test/api/v1/learning-positions", expect.objectContaining({ method: "GET", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer token-${owner}`, "content-type": "application/json" } }));
});
test("binding-filtered lookup can recover an omitted latest receipt and rejects mismatched responses", async () => {
  http.mockImplementation(async () => Response.json(workspace));
  expect(await chrome.listener!({ type: "LOAD_LEARNING_POSITIONS", ownerId: owner, resourceBindingId: command.resourceBindingId.toUpperCase() })).toEqual({ ok: true, value: workspace });
  expect(http.mock.calls[0]![0]).toBe(`https://blueprint.example.test/api/v1/learning-positions?resourceBindingId=${command.resourceBindingId}`);
  expect(await chrome.listener!({ type: "LOAD_LEARNING_POSITIONS", ownerId: owner, resourceBindingId: other })).toEqual({ ok: false, code: "unavailable" });
  http.mockClear();
  expect(await chrome.listener!({ type: "LOAD_LEARNING_POSITIONS", ownerId: owner, resourceBindingId: "../../secret" })).toEqual({ ok: false, code: "invalid" });
  expect(http).not.toHaveBeenCalled();
});
test("explicit position replay preserves original source and CAS without rereading a removed binding", async () => {
  http.mockImplementation(async () => Response.json(position));
  expect(await chrome.listener!({ type: "SAVE_LEARNING_POSITION", ownerId: owner, input: command })).toEqual({ ok: true, value: position });
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]![1]?.method).toBe("POST");
  expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual(command);
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});
test("malformed, foreign, future and duplicated position history is unavailable rather than empty", async () => {
  for (const value of [
    { ok: true, value: workspace }, { ...workspace, records: null }, { ...workspace, extra: true },
    { ...workspace, blueprint: { ...blueprint, schemaVersion: 1 } }, { ...workspace, records: [position, position] },
    { ...workspace, records: [{ ...position, context: { ...position.context, blueprintId: other } }] },
    { ...workspace, records: [{ ...position, context: { ...position.context, blueprintVersion: 3 } }] },
    { ...workspace, records: [{ ...position, resource: { ...position.resource, url: "javascript:alert(1)" } }] },
    { ...workspace, records: [{ ...position, positionVersion: 4 }] },
    { ...workspace, records: [{ ...position, positionSeconds: null }] },
    { ...workspace, records: [{ ...position, context: { ...position.context, extra: true } }] },
  ]) {
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!({ type: "LOAD_LEARNING_POSITIONS", ownerId: owner })).toEqual({ ok: false, code: "unavailable" });
  }
});
test("save receipt must match every command field and invalid commands never reach HTTP", async () => {
  for (const value of [
    { ...position, clientMutationId: other }, { ...position, context: { ...position.context, nodeId: other } },
    { ...position, context: { ...position.context, blueprintVersion: 2 } }, { ...position, resource: { ...position.resource, bindingId: other } },
    { ...position, expectedPositionVersion: 3, positionVersion: 4 }, { ...position, positionSeconds: 1 },
  ]) {
    http.mockImplementation(async () => Response.json(value));
    expect(await chrome.listener!({ type: "SAVE_LEARNING_POSITION", ownerId: owner, input: command })).toEqual({ ok: false, code: "unavailable" });
  }
  http.mockClear();
  for (const input of [{ ...command, positionSeconds: -1 }, { ...command, positionSeconds: null }, { ...command, expectedPositionVersion: 2147483647 }, { ...command, unknown: true }])
    expect(await chrome.listener!({ type: "SAVE_LEARNING_POSITION", ownerId: owner, input })).toEqual({ ok: false, code: "invalid" });
  expect(http).not.toHaveBeenCalled();
});
test.each(["LOAD_LEARNING_POSITIONS", "SAVE_LEARNING_POSITION"])("%s hides foreign-account requests and late receipts after identity changes", async type => {
  expect(await chrome.listener!({ type, ownerId: other, input: command })).toEqual({ ok: false, code: "forbidden" });
  expect(http).not.toHaveBeenCalled();
  let finish!: (value: Response) => void;
  http.mockImplementation(async () => new Promise(resolve => { finish = resolve; }));
  const pending = chrome.listener!({ type, ownerId: owner, input: command });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  signIn(other); finish(Response.json(type === "LOAD_LEARNING_POSITIONS" ? workspace : position));
  expect(await pending).toEqual({ ok: false, code: "forbidden" });
});
test("uncertain saves require explicit identical retry and generic gateway errors never invent rejection or logout", async () => {
  const send = () => chrome.listener!({ type: "SAVE_LEARNING_POSITION", ownerId: owner, input: command });
  http.mockRejectedValueOnce(new TypeError("lost receipt"));
  expect(await send()).toEqual({ ok: false, code: "unavailable" }); expect(http).toHaveBeenCalledTimes(1);
  http.mockImplementation(async () => Response.json(position));
  expect(await send()).toEqual({ ok: true, value: position });
  expect(http.mock.calls.map(([,options]) => JSON.parse(String(options?.body)))).toEqual([command, command]);
  for (const status of [401, 409, 422, 502]) {
    http.mockImplementation(async () => Response.json({ error: "gateway" }, { status }));
    expect(await send()).toEqual({ ok: false, code: "unavailable" });
  }
  expect(await chrome.listener!({ type: "AUTH_STATUS" })).toEqual({ connected: true, userId: owner });
  http.mockImplementation(async () => Response.json({ code: "version_conflict" }, { status: 409 }));
  expect(await send()).toEqual({ ok: false, code: "version_conflict" });
  expect(chrome.stored.blueprint_session_outbox_v1 ?? []).toEqual([]);
});
