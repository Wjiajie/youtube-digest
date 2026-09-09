import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { recordProgressEvidenceAction } from "@/app/progress-evidence-actions";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));
const ownerId = "a4000000-0000-4000-8000-000000000001";
const extensionId = "evidence-extension";
const input = {
  nodeId: "a4000000-0000-4000-8000-000000000030", expectedVersion: 2,
  text: "完成了首次录制", artifactUrl: "https://example.test/my-talk",
  clientMutationId: "a4000000-0000-4000-8000-000000000040",
};
const row = {
  id: "a4000000-0000-4000-8000-000000000050", owner_id: ownerId,
  blueprint_id: "a4000000-0000-4000-8000-000000000005", blueprint_version: 2,
  goal_id: "a4000000-0000-4000-8000-000000000010", goal_title: "演讲能力",
  stage_id: "a4000000-0000-4000-8000-000000000020", stage_title: "第一周",
  node_id: input.nodeId, node_title: "录制三分钟演讲", node_type: "practice",
  evidence_text: input.text, artifact_url: input.artifactUrl,
  client_mutation_id: input.clientMutationId, created_at: "2026-09-10T00:00:00.000Z",
};
const expected = {
  id: row.id, clientMutationId: input.clientMutationId,
  context: {
    blueprintId: row.blueprint_id, blueprintVersion: 2,
    goalId: row.goal_id, goalTitle: "演讲能力", stageId: row.stage_id, stageTitle: "第一周",
    nodeId: input.nodeId, nodeTitle: "录制三分钟演讲", nodeType: "practice",
  },
  text: input.text, artifactUrl: input.artifactUrl, createdAt: row.created_at,
};
let records: typeof row[];
let authStatus: number;
let databaseCode: string | null;
function token(clientId?: string) {
  return ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: ownerId, ...(clientId ? { client_id: clientId } : {}) })).toString("base64url"), "fixture"].join(".");
}
function request(body?: unknown) {
  return new NextRequest("https://blueprint.example.test/api/v1/progress-evidence", {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token(extensionId)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function signInWeb() {
  cookieJar.push({ name: "sb-evidence-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: token(), refresh_token: "fixture-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer", user: { id: ownerId },
  })).toString("base64url")}` });
}
beforeEach(() => {
  records = []; cookieJar.length = 0; authStatus = 200; databaseCode = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://evidence.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-publishable");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extensionId);
  // Real application/Auth/SDK; only the external provider transport is a fixture.
  // Database authorization and idempotence are separately tested in actual PostgreSQL.
  vi.stubGlobal("fetch", async (value: RequestInfo | URL, init?: RequestInit) => {
    const req = value instanceof Request ? value : new Request(value, init);
    const url = new URL(req.url);
    if (url.pathname === "/auth/v1/user") return authStatus === 200
      ? Response.json({ id: ownerId }) : Response.json({ message: "private auth detail" }, { status: authStatus });
    if (databaseCode) return Response.json({ code: databaseCode, message: "private database detail" }, { status: 400 });
    if (url.pathname === "/rest/v1/rpc/record_progress_evidence" && req.method === "POST") {
      const body = await req.json();
      expect(body).toEqual({
        p_node_id: input.nodeId, p_expected_version: 2, p_evidence_text: input.text,
        p_artifact_url: input.artifactUrl, p_client_mutation_id: input.clientMutationId,
      });
      records = [row];
      return Response.json(row);
    }
    if (url.pathname === "/rest/v1/progress_evidence" && req.method === "GET") {
      expect(url.searchParams.get("owner_id")).toBe(`eq.${ownerId}`);
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
      return Response.json(records);
    }
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("records a Web outcome and lets the connected extension read its private context", async () => {
  signInWeb();
  expect(await recordProgressEvidenceAction(ownerId, input)).toEqual({ ok: true, value: expected });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual([expected]);
});

it.each([
  { ...input, text: " \n\t " },
  { ...input, text: "文".repeat(8001) },
  { ...input, artifactUrl: "not a URL" },
  { ...input, artifactUrl: "javascript:alert(1)" },
  { ...input, artifactUrl: "https://user:secret@example.test/" },
  { ...input, artifactUrl: "https://example.test/\nsecret" },
  { ...input, expectedVersion: null },
  { ...input, ownerId: "another-account" },
  { ...input, nodeTitle: "forged context" },
])("rejects invalid or forged input without recording it: %j", async (invalid) => {
  signInWeb();
  expect(await recordProgressEvidenceAction(ownerId, invalid)).toEqual({ ok: false, code: "invalid" });
  const response = await GET(request());
  expect(await response.json()).toEqual([]);
});

it("allows an authenticated extension to record and read an outcome", async () => {
  const saved = await POST(request(input));
  expect(saved.status).toBe(200);
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toEqual(expected);
  expect(await (await GET(request())).json()).toEqual([expected]);
});

it("rejects a stale Web page after the account changes", async () => {
  signInWeb();
  expect(await recordProgressEvidenceAction("a4000000-0000-4000-8000-000000000002", input))
    .toEqual({ ok: false, code: "forbidden" });
  expect(await (await GET(request())).json()).toEqual([]);
});

it("does not accept cookie-only POSTs in the extension mutation endpoint", async () => {
  signInWeb();
  const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/progress-evidence", {
    method: "POST", body: JSON.stringify(input),
  }));
  expect(response.status).toBe(401);
  expect(await (await GET(request())).json()).toEqual([]);
});

it("requires an identified account for Web reads and writes", async () => {
  expect(await recordProgressEvidenceAction(ownerId, input)).toEqual({ ok: false, code: "unauthenticated" });
  const response = await GET(new NextRequest("https://blueprint.example.test/api/v1/progress-evidence"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it.each(["unknown-client", ""])("fails closed when the configured extension is %j", async (configured) => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", configured);
  for (const response of [await GET(request()), await POST(request(input))]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

it.each([["P0002", 404, "not_found"], ["40001", 409, "version_conflict"], ["42501", 403, "forbidden"], ["22023", 422, "invalid"], ["23514", 422, "invalid"], ["XX000", 503, "unavailable"]] as const)(
  "preserves the public meaning of database error %s without disclosing private details", async (databaseError, status, code) => {
    databaseCode = databaseError; signInWeb();
    expect(await recordProgressEvidenceAction(ownerId, input)).toEqual({ ok: false, code });
    const response = await POST(request(input));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code });
  },
);

it.each([429, 503])("preserves Auth provider failure %i as unavailable", async (status) => {
  authStatus = status; signInWeb();
  expect(await recordProgressEvidenceAction(ownerId, input)).toEqual({ ok: false, code: "unavailable" });
  for (const response of [await GET(request()), await POST(request(input))]) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "unavailable" });
  }
});

it("reports malformed JSON as invalid, not a service outage", async () => {
  const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/progress-evidence", {
    method: "POST", headers: { authorization: `Bearer ${token(extensionId)}` }, body: "{broken",
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ code: "invalid" });
});

it("does not return another owner's provider row to the current account", async () => {
  records = [{ ...row, owner_id: "a4000000-0000-4000-8000-000000000002" }];
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "unavailable" });
});

it("keeps historical text and links readable without applying today's input normalization", async () => {
  // PostgreSQL counts Unicode code points, not UTF-16 units. Direct RPC data
  // must not poison the entire feed through the stricter current form validator.
  records = [{ ...row, evidence_text: `\n${"🙂".repeat(5000)}\n`, artifact_url: "https://example.test:99999/artifact" }];
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ ...expected, text: records[0].evidence_text, artifactUrl: records[0].artifact_url }]);
});
