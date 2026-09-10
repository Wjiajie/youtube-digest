import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET, POST } from "./route";
import { recordLearningPositionAction, readLearningPositionWorkspaceAction } from "@/app/learning-position-actions";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));
const id = (suffix: number) => `fd570000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const owner = id(1), extension = "learning-positions-extension";
const command = { nodeId: id(2), resourceBindingId: id(3), expectedVersion: 2, expectedPositionVersion: 3, clientMutationId: id(4), positionSeconds: 0 };
const row = { id: id(5), owner_id: owner, client_mutation_id: command.clientMutationId, blueprint_id: id(6), blueprint_version: 2,
  goal_id: id(7), goal_title: "摄影", stage_id: id(8), stage_title: "曝光", node_id: command.nodeId, node_title: "理解光线", node_type: "learn",
  resource_binding_id: command.resourceBindingId, video_id: "abcdefghijk", resource_url: "https://www.youtube.com/watch?v=abcdefghijk",
  position_seconds: 0, expected_position_version: 3, position_version: 4, created_at: "2026-09-11T00:00:00.000Z" };
const expected = { id: id(5), clientMutationId: command.clientMutationId,
  context: { blueprintId: id(6), blueprintVersion: 2, goalId: id(7), goalTitle: "摄影", stageId: id(8), stageTitle: "曝光", nodeId: id(2), nodeTitle: "理解光线", nodeType: "learn" },
  resource: { bindingId: id(3), videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  positionSeconds: 0, expectedPositionVersion: 3, positionVersion: 4, createdAt: row.created_at };
const blueprint = { schemaVersion: 2, id: id(6), title: "我的蓝图", version: 3, goals: [] };
let rows: Record<string, unknown>[], receipt: Record<string, unknown>, calls: string[], authStatus: number, databaseCode: string | null;
let requestedBinding: string | undefined;
function token(clientId?: string) { return ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: owner, ...(clientId ? { client_id: clientId } : {}) })).toString("base64url"), "fixture"].join("."); }
function request(input?: unknown, clientId = extension) { return new NextRequest("https://blueprint.example.test/api/v1/learning-positions", {
  method: input === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token(clientId)}`, "content-type": "application/json" },
  ...(input === undefined ? {} : { body: JSON.stringify(input) }),
}); }
function signIn() { cookieJar.push({ name: "sb-positions-auth-token", value: `base64-${Buffer.from(JSON.stringify({ access_token: token(), refresh_token: "fixture-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: owner } })).toString("base64url")}` }); }
beforeEach(() => {
  cookieJar.length = 0; rows = []; receipt = { ...row }; calls = []; authStatus = 200; databaseCode = null; requestedBinding = undefined;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://positions.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-publishable");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extension);
  vi.stubGlobal("fetch", async (value: RequestInfo | URL, init?: RequestInit) => {
    const req = value instanceof Request ? value : new Request(value, init), url = new URL(req.url);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return authStatus === 200 ? Response.json({ id: owner }) : Response.json({ message: "private auth detail" }, { status: authStatus });
    if (databaseCode) return Response.json({ code: databaseCode, message: "private database detail" }, { status: 400 });
    if (url.pathname === "/rest/v1/rpc/record_learning_position") {
      expect(await req.json()).toEqual({ p_node_id: command.nodeId, p_resource_binding_id: command.resourceBindingId, p_expected_version: 2,
        p_expected_position_version: 3, p_position_seconds: 0, p_client_mutation_id: command.clientMutationId });
      rows = [receipt]; return Response.json(receipt);
    }
    if (url.pathname === "/rest/v1/rpc/read_learning_position_workspace") {
      expect(await req.json()).toEqual({ p_owner_id: owner, ...(requestedBinding ? { p_resource_binding_id: requestedBinding } : {}) }); return Response.json({ blueprint, records: rows });
    }
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("Web and extension clients read the same explicitly saved position without exposing owner fields", async () => {
  signIn(); expect(await recordLearningPositionAction(owner, command)).toEqual({ ok: true, value: expected });
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ blueprint, records: [expected] });
  expect(await readLearningPositionWorkspaceAction(owner)).toEqual({ ok: true, value: { blueprint, records: [expected] } });
  const saved = await POST(request(command)); expect(saved.status).toBe(200); expect(await saved.json()).toEqual(expected);
});

test("anonymous, stale bound pages and unapproved extension clients cannot read or initiate a position write", async () => {
  expect(await recordLearningPositionAction(owner, command)).toEqual({ ok: false, code: "unauthenticated" });
  expect((await GET(new NextRequest("https://blueprint.example.test/api/v1/learning-positions"))).status).toBe(401);
  signIn();
  expect(await recordLearningPositionAction(id(99), command)).toEqual({ ok: false, code: "forbidden" });
  expect(await readLearningPositionWorkspaceAction(id(99))).toEqual({ ok: false, code: "forbidden" });
  expect((await POST(new NextRequest("https://blueprint.example.test/api/v1/learning-positions", { method: "POST", body: JSON.stringify(command) }))).status).toBe(401);
  expect((await POST(request(command, "unknown-client"))).status).toBe(401);
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "");
  expect((await POST(request(command))).status).toBe(401);
  expect(calls.every(path => path === "/auth/v1/user")).toBe(true);
});

test.each([429, 503])("Auth %i is unavailable, not an invalid account", async status => {
  authStatus = status; signIn();
  expect(await recordLearningPositionAction(owner, command)).toEqual({ ok: false, code: "unavailable" });
  for (const response of [await POST(request(command)), await GET(request())]) {
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "unavailable" });
  }
});

test.each([["P0002", 404, "not_found"], ["40001", 409, "version_conflict"], ["42501", 403, "forbidden"],
  ["22023", 422, "invalid"], ["23514", 422, "invalid"], ["XX000", 503, "unavailable"]] as const)(
  "database %s keeps a content-free error classification", async (code, status, publicCode) => {
    databaseCode = code; signIn();
    expect(await recordLearningPositionAction(owner, command)).toEqual({ ok: false, code: publicCode });
    for (const response of [await POST(request(command)), await GET(request())]) {
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ code: publicCode });
    }
  },
);

test.each([{ ownerId: id(99) }, { expectedPositionVersion: null }, { positionSeconds: null }, { positionSeconds: 0.5 },
  { nodeTitle: "伪造标题" }, { watchedSeconds: 42 }])("invalid position commands never reach persistence: %j", async change => {
  expect((await POST(request({ ...command, ...change }))).status).toBe(422);
  expect(calls).toEqual(["/auth/v1/user"]);
});

test.each([{ owner_id: id(99) }, { position_seconds: 1 }, { node_id: id(99) }, { resource_binding_id: id(99) },
  { client_mutation_id: id(99) }, { blueprint_version: 1 }, { expected_position_version: 2 }, { position_version: 9 },
  { expected_position_version: 2, position_version: 3 }])("a mismatched receipt is uncertain, not successful: %j", async change => {
    receipt = { ...row, ...change }; const response = await POST(request(command));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "unavailable" });
});

test.each([
  [{ ...row, owner_id: id(99) }], [{ ...row, blueprint_id: id(99) }], [{ ...row, blueprint_version: 4 }], [row, row],
  [row, { ...row, id: id(50), client_mutation_id: id(51), position_version: 5, expected_position_version: 4 }],
  [{ ...row, resource_url: "https://example.test/?v=abcdefghijk" }], Array.from({ length: 51 }, () => row),
].map(invalid => ({ invalid })))("incoherent latest-position workspace is rejected as a whole", async ({ invalid }) => {
  rows = invalid; const response = await GET(request()); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "unavailable" });
});

test("media type, malformed JSON and actual byte count are checked before persistence", async () => {
  for (const [body, contentType, status] of [["{broken", "application/json", 422], ["{}", "text/plain", 422], [" ".repeat(65_537), "application/json", 413]] as const) {
    const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/learning-positions", { method: "POST",
      headers: { authorization: `Bearer ${token(extension)}`, "content-type": contentType, "content-length": "1" }, body }));
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "invalid" });
  }
  expect(calls.every(path => path === "/auth/v1/user")).toBe(true);
});

test("an older resource can be read directly for its next save without being in the fifty recent bindings", async () => {
  requestedBinding = command.resourceBindingId; rows = [row];
  const response = await GET(new NextRequest(`https://blueprint.example.test/api/v1/learning-positions?resourceBindingId=${requestedBinding.toUpperCase()}`,
    { headers: { authorization: `Bearer ${token(extension)}` } }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ blueprint, records: [expected] });
  signIn(); expect(await readLearningPositionWorkspaceAction(owner, requestedBinding)).toEqual({ ok: true, value: { blueprint, records: [expected] } });
});

test.each(["resourceBindingId=", "resourceBindingId=invalid", `resourceBindingId=${id(3)}&resourceBindingId=${id(3)}`, "ownerId=someone"])(
  "ambiguous or invalid filters are rejected before reading private records: %s", async query => {
    const response = await GET(new NextRequest(`https://blueprint.example.test/api/v1/learning-positions?${query}`,
      { headers: { authorization: `Bearer ${token(extension)}` } }));
    expect(response.status).toBe(422); expect(calls).toEqual(["/auth/v1/user"]);
  },
);

test("a filtered read cannot silently return another binding as the requested position", async () => {
  requestedBinding = id(99); rows = [row]; signIn();
  expect(await readLearningPositionWorkspaceAction(owner, requestedBinding)).toEqual({ ok: false, code: "unavailable" });
});
