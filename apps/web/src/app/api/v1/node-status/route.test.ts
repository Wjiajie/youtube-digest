import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { confirmNodeStatusAction, readNodeStatusWorkspaceAction } from "@/app/node-status-actions";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));
const ownerId = "a6000000-0000-4000-8000-000000000001", extensionId = "status-extension";
const input = { nodeId: "a6000000-0000-4000-8000-000000000030", expectedVersion: 2,
  expectedStatusRevision: 0, status: "completed", evidenceId: null,
  clientMutationId: "a6000000-0000-4000-8000-000000000040" };
const originalRow = {
  id: "a6000000-0000-4000-8000-000000000050", owner_id: ownerId,
  blueprint_id: "a6000000-0000-4000-8000-000000000005", blueprint_version: 2,
  goal_id: "a6000000-0000-4000-8000-000000000010", goal_title: "演讲能力",
  stage_id: "a6000000-0000-4000-8000-000000000020", stage_title: "第一周",
  node_id: input.nodeId, node_title: "录制三分钟演讲", node_type: "practice",
  estimated_minutes: 90, completion_criteria: "保存录制并指出三个改进点",
  status: "completed", revision: 1, evidence_id: null,
  client_mutation_id: input.clientMutationId, created_at: "2026-09-10T00:00:00.000Z",
};
const blueprint = { schemaVersion: 2, id: originalRow.blueprint_id, title: "我的蓝图", version: 2,
  goals: [{ id: originalRow.goal_id, title: "演讲能力", position: 0,
    stages: [{ id: originalRow.stage_id, title: "第一周", position: 0,
      nodes: [{ id: input.nodeId, title: "录制三分钟演讲", type: "practice", position: 0,
        dependencyIds: [], resources: [], estimatedMinutes: 90, completionCriteria: "保存录制并指出三个改进点" }] }] }] };
const expected = {
  id: originalRow.id, clientMutationId: input.clientMutationId,
  context: { blueprintId: blueprint.id, blueprintVersion: 2, goalId: originalRow.goal_id,
    goalTitle: "演讲能力", stageId: originalRow.stage_id, stageTitle: "第一周",
    nodeId: input.nodeId, nodeTitle: "录制三分钟演讲", nodeType: "practice" },
  estimatedMinutes: 90, completionCriteria: "保存录制并指出三个改进点", status: "completed",
  revision: 1, evidenceId: null, createdAt: originalRow.created_at,
};
let row: typeof originalRow;
let authStatus: number, databaseCode: string | null, evidenceFailure: boolean, missingWorkspace: boolean;
let saved: boolean;
function token(clientId?: string) {
  return ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: ownerId, ...(clientId ? { client_id: clientId } : {}) })).toString("base64url"), "external-fixture"].join(".");
}
function request(body?: unknown) {
  return new NextRequest("https://blueprint.example.test/api/v1/node-status", {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token(extensionId)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function signInWeb() {
  cookieJar.push({ name: "sb-status-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: token(), refresh_token: "fixture-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer", user: { id: ownerId },
  })).toString("base64url")}` });
}
beforeEach(() => {
  row = { ...originalRow }; saved = false; cookieJar.length = 0;
  authStatus = 200; databaseCode = null; evidenceFailure = false; missingWorkspace = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://status.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-publishable");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extensionId);
  // Only external provider transport is simulated; actual DB roles and concurrency
  // are verified separately through public PostgreSQL operations.
  vi.stubGlobal("fetch", async (value: RequestInfo | URL, init?: RequestInit) => {
    const req = value instanceof Request ? value : new Request(value, init);
    const url = new URL(req.url);
    if (url.pathname === "/auth/v1/user") return authStatus === 200 ? Response.json({ id: ownerId })
      : Response.json({ message: "private auth detail" }, { status: authStatus });
    if (databaseCode) return Response.json({ code: databaseCode, message: "private database detail" }, { status: 400 });
    if (url.pathname === "/rest/v1/rpc/confirm_node_status") {
      expect(await req.json()).toEqual({ p_node_id: input.nodeId, p_expected_version: 2,
        p_expected_status_revision: 0, p_status: "completed", p_evidence_id: null,
        p_client_mutation_id: input.clientMutationId });
      saved = true; return Response.json(row);
    }
    if (url.pathname === "/rest/v1/rpc/read_node_status_workspace") {
      expect(await req.json()).toEqual({ p_owner_id: ownerId });
      return Response.json(missingWorkspace ? null : { blueprint, current: saved ? [row] : [], history: saved ? [row] : [] });
    }
    if (url.pathname === "/rest/v1/progress_evidence") return evidenceFailure
      ? Response.json({ code: "XX000", message: "private evidence detail" }, { status: 500 }) : Response.json([]);
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("records a Web self-assessment and reads it through the connected extension without claiming mastery", async () => {
  signInWeb();
  expect(await confirmNodeStatusAction(ownerId, input)).toEqual({ ok: true, value: expected });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ blueprint, current: [expected], history: [expected], evidence: { ok: true, value: [] } });
});

it.each([["P0002", 404, "not_found"], ["40001", 409, "version_conflict"], ["42501", 403, "forbidden"],
  ["22023", 422, "invalid"], ["23514", 422, "invalid"], ["XX000", 503, "unavailable"]] as const)(
  "exposes %s as a recoverable outcome without private database details", async (code, status, resultCode) => {
    signInWeb(); databaseCode = code;
    expect(await confirmNodeStatusAction(ownerId, input)).toEqual({ ok: false, code: resultCode });
    const response = await POST(request(input));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: resultCode });
  },
);

it("keeps status and criteria available when the optional evidence feed is unavailable", async () => {
  signInWeb(); evidenceFailure = true;
  expect(await readNodeStatusWorkspaceAction(ownerId)).toEqual({ ok: true, value: {
    blueprint, current: [], history: [], evidence: { ok: false, code: "unavailable" },
  } });
});

it("does not invent an empty workspace when no owned Blueprint is returned", async () => {
  missingWorkspace = true;
  expect(await (await GET(request())).json()).toEqual({ code: "not_found" });
});

it("allows only the configured extension to POST, and binds Web actions to the original account", async () => {
  expect((await POST(request(input))).status).toBe(200);
  signInWeb();
  const other = "a6000000-0000-4000-8000-000000000002";
  expect(await confirmNodeStatusAction(other, input)).toEqual({ ok: false, code: "forbidden" });
  expect(await readNodeStatusWorkspaceAction(other)).toEqual({ ok: false, code: "forbidden" });
  expect((await POST(new NextRequest("https://blueprint.example.test/api/v1/node-status", {
    method: "POST", body: JSON.stringify(input),
  }))).status).toBe(401);
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "");
  expect((await POST(request(input))).status).toBe(401);
  expect((await GET(request())).status).toBe(401);
});

it("rejects anonymous access, malformed bodies and client-invented context", async () => {
  expect(await confirmNodeStatusAction(ownerId, input)).toEqual({ ok: false, code: "unauthenticated" });
  expect((await GET(new NextRequest("https://blueprint.example.test/api/v1/node-status"))).status).toBe(401);
  expect((await POST(new NextRequest("https://blueprint.example.test/api/v1/node-status", {
    method: "POST", headers: { authorization: `Bearer ${token(extensionId)}` }, body: "{broken",
  }))).status).toBe(422);
  expect((await POST(request({ ...input, completionCriteria: "forged" }))).status).toBe(422);
  expect(saved).toBe(false);
});

it.each([429, 503])("does not misreport Auth outage %i as logout", async status => {
  signInWeb(); authStatus = status;
  expect(await confirmNodeStatusAction(ownerId, input)).toEqual({ ok: false, code: "unavailable" });
  expect(await readNodeStatusWorkspaceAction(ownerId)).toEqual({ ok: false, code: "unavailable" });
  expect((await GET(request())).status).toBe(503);
});

it("refuses provider records from another account instead of exposing their criteria", async () => {
  row.owner_id = "a6000000-0000-4000-8000-000000000002"; saved = true;
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "unavailable" });
});
