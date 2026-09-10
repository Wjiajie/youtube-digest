import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET, POST } from "./route";
import { recordLearningNoteAction, readLearningNoteWorkspaceAction } from "@/app/learning-note-actions";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));
const id = (suffix: number) => `fd510000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const owner = id(1), extension = "learning-notes-extension";
const command = { nodeId: id(2), resourceBindingId: id(3), expectedVersion: 2, clientMutationId: id(4), text: "  在这里理解光圈。\n", positionSeconds: 0 };
const row = { id: id(5), owner_id: owner, client_mutation_id: command.clientMutationId, blueprint_id: id(6), blueprint_version: 2,
  goal_id: id(7), goal_title: "摄影", stage_id: id(8), stage_title: "曝光", node_id: command.nodeId, node_title: "理解光线", node_type: "learn",
  resource_binding_id: command.resourceBindingId, video_id: "abcdefghijk", resource_url: "https://www.youtube.com/watch?v=abcdefghijk",
  position_seconds: 0, note_text: command.text, created_at: "2026-09-10T00:00:00.000Z" };
const expected = { id: id(5), clientMutationId: command.clientMutationId,
  context: { blueprintId: id(6), blueprintVersion: 2, goalId: id(7), goalTitle: "摄影", stageId: id(8), stageTitle: "曝光", nodeId: id(2), nodeTitle: "理解光线", nodeType: "learn" },
  resource: { bindingId: id(3), videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, text: command.text, positionSeconds: 0, createdAt: row.created_at };
const blueprint = { schemaVersion: 2, id: id(6), title: "我的蓝图", version: 3, goals: [] };
let rows: Record<string, unknown>[], receipt: Record<string, unknown>, calls: string[], authStatus: number, databaseCode: string | null;
function token(clientId?: string) { return ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: owner, ...(clientId ? { client_id: clientId } : {}) })).toString("base64url"), "fixture"].join("."); }
function request(input?: unknown, clientId = extension) { return new NextRequest("https://blueprint.example.test/api/v1/learning-notes", {
  method: input === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token(clientId)}`, "content-type": "application/json" },
  ...(input === undefined ? {} : { body: JSON.stringify(input) }),
}); }
function signIn() { cookieJar.push({ name: "sb-notes-auth-token", value: `base64-${Buffer.from(JSON.stringify({ access_token: token(), refresh_token: "fixture-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: owner } })).toString("base64url")}` }); }
beforeEach(() => {
  cookieJar.length = 0; rows = []; receipt = { ...row }; calls = []; authStatus = 200; databaseCode = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://notes.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-publishable");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extension);
  vi.stubGlobal("fetch", async (value: RequestInfo | URL, init?: RequestInit) => {
    const req = value instanceof Request ? value : new Request(value, init), url = new URL(req.url);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return authStatus === 200 ? Response.json({ id: owner }) : Response.json({ message: "private auth detail" }, { status: authStatus });
    if (databaseCode) return Response.json({ code: databaseCode, message: "private database detail" }, { status: 400 });
    if (url.pathname === "/rest/v1/rpc/record_learning_note") {
      expect(await req.json()).toEqual({ p_node_id: command.nodeId, p_resource_binding_id: command.resourceBindingId, p_expected_version: 2,
        p_note_text: command.text, p_position_seconds: 0, p_client_mutation_id: command.clientMutationId });
      rows = [receipt]; return Response.json(receipt);
    }
    if (url.pathname === "/rest/v1/rpc/read_learning_note_workspace") {
      expect(await req.json()).toEqual({ p_owner_id: owner }); return Response.json({ blueprint, records: rows });
    }
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("a Web save and an extension read share the exact timestamp note without returning database owner fields", async () => {
  signIn(); expect(await recordLearningNoteAction(owner, command)).toEqual({ ok: true, value: expected });
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ blueprint, records: [expected] });
});

test("an extension can explicitly save while a Web page can reread the same workspace", async () => {
  const response = await POST(request(command)); expect(response.status).toBe(200); expect(await response.json()).toEqual(expected);
  signIn(); expect(await readLearningNoteWorkspaceAction(owner)).toEqual({ ok: true, value: { blueprint, records: [expected] } });
});

test("anonymous and stale Web pages and unapproved extension clients cannot initiate a note write", async () => {
  expect(await recordLearningNoteAction(owner, command)).toEqual({ ok: false, code: "unauthenticated" });
  expect((await GET(new NextRequest("https://blueprint.example.test/api/v1/learning-notes"))).status).toBe(401);
  signIn();
  expect(await recordLearningNoteAction(id(99), command)).toEqual({ ok: false, code: "forbidden" });
  expect(await readLearningNoteWorkspaceAction(id(99))).toEqual({ ok: false, code: "forbidden" });
  expect((await POST(new NextRequest("https://blueprint.example.test/api/v1/learning-notes", { method: "POST", body: JSON.stringify(command) }))).status).toBe(401);
  expect((await POST(request(command, "unknown-client"))).status).toBe(401);
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "");
  expect((await POST(request(command))).status).toBe(401);
  expect(calls.every(path => path === "/auth/v1/user")).toBe(true);
});

test.each([429, 503])("Auth %i remains an unavailable service, not a rejected account", async status => {
  authStatus = status; signIn();
  expect(await recordLearningNoteAction(owner, command)).toEqual({ ok: false, code: "unavailable" });
  for (const response of [await POST(request(command)), await GET(request())]) {
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "unavailable" });
  }
});

test.each([["P0002", 404, "not_found"], ["40001", 409, "version_conflict"], ["42501", 403, "forbidden"], ["22023", 422, "invalid"], ["23514", 422, "invalid"], ["XX000", 503, "unavailable"]] as const)(
  "database %s keeps a fixed private classification rather than disclosing the original error", async (code, status, publicCode) => {
    databaseCode = code; signIn();
    expect(await recordLearningNoteAction(owner, command)).toEqual({ ok: false, code: publicCode });
    for (const response of [await POST(request(command)), await GET(request())]) {
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ code: publicCode });
    }
  },
);

test.each([{ ...command, ownerId: id(99) }, { ...command, text: " \n\u3000 " }, { ...command, text: "x".repeat(8001) },
  { ...command, positionSeconds: 0.5 }, { ...command, nodeTitle: "伪造标题" }])("invalid or forged note commands never reach persistence: %j", async invalid => {
  expect((await POST(request(invalid))).status).toBe(422);
  expect(calls).toEqual(["/auth/v1/user"]);
});

test.each([{ owner_id: id(99) }, { note_text: "different" }, { position_seconds: 1 }, { node_id: id(99) },
  { resource_binding_id: id(99) }, { client_mutation_id: id(99) }, { blueprint_version: 1 }])("a mismatched save receipt is uncertain, not successful: %j", async changed => {
  receipt = { ...row, ...changed }; const response = await POST(request(command));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "unavailable" });
});

test.each([
  { invalid: [{ ...row, owner_id: id(99) }] }, { invalid: [{ ...row, blueprint_id: id(99) }] }, { invalid: [{ ...row, blueprint_version: 4 }] },
  { invalid: [row, row] }, { invalid: [{ ...row, resource_url: "https://example.test/?v=abcdefghijk" }] },
])("incoherent private history fails as a workspace instead of leaking or hiding records", async ({ invalid }) => {
  rows = invalid; const response = await GET(request());
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "unavailable" });
});

test("actual body bytes, strict JSON and media type are guarded before persistence", async () => {
  for (const [body, contentType, status] of [["{broken", "application/json", 422], ["{}", "text/plain", 422], [" ".repeat(65_537), "application/json", 413]] as const) {
    const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/learning-notes", { method: "POST",
      headers: { authorization: `Bearer ${token(extension)}`, "content-type": contentType, "content-length": "1" }, body }));
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "invalid" });
  }
  expect(calls.every(path => path === "/auth/v1/user")).toBe(true);
});
