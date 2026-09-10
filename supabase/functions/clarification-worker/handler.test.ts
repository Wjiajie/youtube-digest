import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createClarificationWorker } from "./handler.ts";
import { setTimeout as delay } from "node:timers/promises";

const owner = "10000000-0000-4000-8000-000000000001", turnId = "10000000-0000-4000-8000-000000000002", leaseId = "10000000-0000-4000-8000-000000000003";
const environment = { url: "http://localhost:54321", anonKey: "public-key", serviceRoleKey: "edge-admin-only", workerSecret: "separate-clarification-worker-credential" };
const skill = { name: "blueprint-clarify-goal", version: "1.0.0", sha256: "a".repeat(64), instructions: "Fixed clarification skill" };
const claim = { operation: "claim", turnId, leaseId, skill };
const suggestion = {
  status: "needs_input", providerMayHaveRun: true, usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 },
  reflection: "你想提升摄影能力。", changes: [{ field: "outcome", value: "改善照片构图", quote: "改善照片构图" }],
  question: { field: "startingPoint", text: "你目前拍照时最想改变什么？" }, concerns: [], pause: null,
  content: { schemaVersion: 1, outcome: "改善照片构图", startingPoint: "", targetDate: null, weeklyMinutes: null, constraints: "", successCriteria: "" },
  readiness: { missing: ["startingPoint", "weeklyMinutes", "successCriteria"], uncertainties: ["targetDate", "constraints"] },
  skill, source: { briefId: leaseId, briefRevision: 3, blueprintId: owner, turnId },
};
const headers = { "content-type": "application/json", authorization: "Bearer header.claims.signature", "x-blueprint-worker-secret": environment.workerSecret };
const request = (body: unknown = claim, extraHeaders = {}) => new Request("http://localhost/functions/v1/clarification-worker", { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });

// Compile-time check against the installed SDK; only external Auth/RPC are doubled.
const sdkFactory: Parameters<typeof createClarificationWorker>[1] = (url, key, options) => {
  const client = createClient(url, key, options);
  return { auth: client.auth, rpc: (name, args) => client.rpc(name, args) };
};
void sdkFactory;
function fixture(options: { claims?: Record<string, unknown>; user?: Record<string, unknown>; authError?: unknown; userError?: unknown; rpcError?: unknown } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [], keys: string[] = [], tokens: string[] = [];
  const claims = { sub: owner, role: "authenticated", is_anonymous: false, session_id: leaseId, exp: 4102444800, ...options.claims };
  const user = { id: owner, role: "authenticated", is_anonymous: false, ...options.user };
  const worker = createClarificationWorker(environment, (_url, key) => {
    keys.push(key);
    return {
      auth: {
        getClaims: async jwt => { tokens.push(jwt); return { data: { claims }, error: options.authError ?? null }; },
        getUser: async jwt => { tokens.push(jwt); return { data: { user }, error: options.userError ?? null }; },
      },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: { acquired: true, turn: { id: turnId, owner_id: owner } }, error: options.rpcError ?? null }; },
    };
  });
  return { worker, calls, keys, tokens };
}
test("claims a clarification turn for the independently verified owner with its original lease and Skill", async () => {
  const f = fixture(); const response = await f.worker(request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.tokens, ["header.claims.signature", "header.claims.signature"]);
  assert.deepEqual(f.keys, [environment.anonKey, environment.serviceRoleKey]);
  assert.deepEqual(f.calls, [{ name: "claim_goal_clarification", args: { p_owner_id: owner, p_turn_id: turnId, p_lease_id: leaseId, p_skill: skill } }]);
  assert.deepEqual(await response.json(), { data: { acquired: true, turn: { id: turnId, owner_id: owner } }, error: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("finishes a sanitized failure without changing its uncertainty or retrying", async () => {
  for (const status of ["invalid_input", "unavailable", "invalid_output", "cancelled", "timed_out"]) {
    const f = fixture(); const result = { status, providerMayHaveRun: false, usage: null };
    const response = await f.worker(request({ operation: "finish", turnId, leaseId, result }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls, [{ name: "finish_goal_clarification", args: { p_owner_id: owner, p_turn_id: turnId, p_lease_id: leaseId, p_result: result } }]);
  }
});
test("preserves each suggestion mode's source, working content, pause and Skill body exactly", async () => {
  for (const result of [
    suggestion,
    { ...suggestion, status: "paused", question: null, pause: { quote: "先暂停" } },
    { ...suggestion, status: "reviewable", question: null,
      content: { ...suggestion.content, startingPoint: "手机摄影", weeklyMinutes: 60, successCriteria: "每周完成一次构图练习" },
      readiness: { missing: [], uncertainties: ["targetDate", "constraints"] } },
  ]) {
    const f = fixture(); const response = await f.worker(request({ operation: "finish", turnId, leaseId, result }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls, [{ name: "finish_goal_clarification", args: { p_owner_id: owner, p_turn_id: turnId, p_lease_id: leaseId, p_result: result } }]);
  }
});
test("refuses client-selected owners, RPCs, operations, planning identifiers and the planning Skill", async () => {
  for (const body of [
    { ...claim, ownerId: owner }, { ...claim, p_owner_id: owner }, { ...claim, rpc: "save_goal_brief" },
    { ...claim, operation: "save" }, { ...claim, turnId: "invalid" }, { ...claim, leaseId: null },
    { ...claim, runId: turnId }, { ...claim, skill: { ...skill, name: "blueprint-plan-path" } },
    { ...claim, skill: { ...skill, instructions: "😀".repeat(16001) } },
  ]) {
    const f = fixture(); assert.equal((await f.worker(request(body))).status, 422);
    assert.deepEqual(f.keys, []); assert.deepEqual(f.calls, []);
  }
});
test("refuses private extra output fields and malformed successful envelopes before Auth", async () => {
  for (const result of [
    { status: "cancelled", providerMayHaveRun: true, usage: null, providerError: "private detail" },
    { ...suggestion, rawResponse: "private detail" }, { ...suggestion, providerMayHaveRun: false },
    { ...suggestion, usage: null }, { ...suggestion, usage: { inputTokens: -1, outputTokens: null, totalTokens: null } },
    { ...suggestion, source: { ...suggestion.source, ownerId: owner } },
    { ...suggestion, source: { ...suggestion.source, briefRevision: 0 } },
    { ...suggestion, changes: [{ ...suggestion.changes[0], rawResponse: "private detail" }] },
    { ...suggestion, question: { ...suggestion.question, hidden: "private detail" } },
    { ...suggestion, pause: { quote: "先暂停", hidden: "private detail" } },
    { ...suggestion, readiness: { ...suggestion.readiness, hidden: "private detail" } },
    { ...suggestion, reflection: "x".repeat(1001) },
    { ...suggestion, status: "ready" }, { ...suggestion, skill: { ...skill, name: "blueprint-plan-path" } },
    { ...suggestion, content: { ...suggestion.content, schemaVersion: 2 } },
  ]) {
    const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", turnId, leaseId, result }))).status, 422);
    assert.deepEqual(f.keys, []); assert.deepEqual(f.calls, []);
  }
});
test("uses a 1 MiB actual-byte limit including multibyte bodies and overclaimed lengths", async () => {
  for (const body of ["x".repeat(1024 * 1024), "😀".repeat(270000)]) {
    const f = fixture(); assert.equal((await f.worker(request({ ...claim, padding: body }))).status, 413);
    assert.deepEqual(f.keys, []);
  }
  const f = fixture();
  assert.equal((await f.worker(request(claim, { "content-length": String(1024 * 1024 + 1) }))).status, 413);
  assert.deepEqual(f.keys, []);
});
test("bounds a stalled upload without waiting for its cancellation hook", async () => {
  const f = fixture(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  });
  const input = new Request("http://localhost", { method: "POST", headers, body,
    ...{ duplex: "half" } });
  const result = await Promise.race([f.worker(input), delay(6000).then(() => null)]);
  assert.equal(result?.status, 408);
  assert.equal(cancelled, true); assert.deepEqual(f.keys, []);
});
test("requires the clarification credential, not the other worker credential or malformed bearer", async () => {
  for (const [extra, expected] of [
    [{ "x-blueprint-worker-secret": "" }, 403],
    [{ "x-blueprint-worker-secret": "independent-worker-credential-32-characters" }, 403],
    [{ authorization: "Bearer forged" }, 401],
  ] as const) {
    const f = fixture(); assert.equal((await f.worker(request(claim, extra))).status, expected); assert.deepEqual(f.keys, []);
  }
});
test("fails closed for missing, short, Supabase-key-shaped, reused or JWT-shaped configured secrets", async () => {
  for (const workerSecret of ["", "short", environment.anonKey, environment.serviceRoleKey, `sb_secret_${"a".repeat(40)}`, `sb_publishable_${"a".repeat(40)}`, `${"a".repeat(32)}.payload.signature`, ` ${environment.workerSecret}`]) {
    let created = false;
    const worker = createClarificationWorker({ ...environment, workerSecret }, () => { created = true; throw new Error(); });
    const response = await worker(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { data: null, error: { code: "XX000", message: "CLARIFICATION_WORKER_UNAVAILABLE" } });
    assert.equal(created, false);
  }
});
test("denies mismatched identities, anonymous/OAuth callers, missing sessions and expired claims before admin", async () => {
  for (const claims of [{ sub: turnId }, { role: "service_role" }, { is_anonymous: true }, { client_id: "oauth-client" }, { client_id: null }, { session_id: null }, { exp: 1 }]) {
    const f = fixture({ claims }); assert.equal((await f.worker(request())).status, 401);
    assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
  }
  for (const user of [{ id: turnId }, { is_anonymous: true }, { role: "anon" }]) {
    const f = fixture({ user }); assert.equal((await f.worker(request())).status, 401);
    assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
  }
});
for (const boundary of ["authError", "userError"] as const) {
  test(`${boundary} keeps known rejections distinct from unavailable Auth without leaking details`, async () => {
    for (const status of [400, 401, 403, 422, 429, 500, 503]) {
      const f = fixture({ [boundary]: { status, message: "private Auth detail" } });
      const response = await f.worker(request());
      assert.equal(response.status, status < 429 ? 401 : 503);
      assert.deepEqual(await response.json(), { data: null, error: status < 429
        ? { code: "42501", message: "CLARIFICATION_FORBIDDEN" }
        : { code: "XX000", message: "CLARIFICATION_WORKER_UNAVAILABLE" } });
      assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
    }
    const f = fixture({ [boundary]: new Error("private Auth detail") });
    assert.equal((await f.worker(request())).status, 503); assert.deepEqual(f.calls, []);
  });
}
test("simultaneous known rejection cannot conceal an unavailable verifier", async () => {
  const f = fixture({ authError: { status: 401 }, userError: { status: 503 } });
  assert.equal((await f.worker(request())).status, 503); assert.deepEqual(f.calls, []);
});
test("only relays the exact clarification database error allowlist and never details", async () => {
  for (const [code, message, status] of [
    ["42501", "CLARIFICATION_FORBIDDEN", 403], ["P0002", "CLARIFICATION_NOT_FOUND", 404],
    ["40001", "CLARIFICATION_VERSION_CONFLICT", 409], ["P0001", "CLARIFICATION_BUSY", 409],
    ["P0001", "CLARIFICATION_QUOTA_EXHAUSTED", 409], ["P0001", "CLARIFICATION_WINDOW_FULL", 409],
    ...["INVALID", "REUSED", "INVALID_SKILL", "INVALID_RESULT", "COMPLETION_REUSED", "INVALID_STATE"].map(name => ["22023", `CLARIFICATION_${name}`, 422] as const),
  ] as const) {
    const f = fixture({ rpcError: { code, message, details: "private payload", hint: "private payload" } });
    const response = await f.worker(request());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { data: null, error: { code, message } });
  }
  for (const rpcError of [{ code: "22023", message: "private response" }, { code: "P0001", message: "CLARIFICATION_NOT_FOUND" }, { code: "P0002", message: "PATH_PLANNING_NOT_FOUND" }]) {
    const f = fixture({ rpcError }); const response = await f.worker(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { data: null, error: { code: "XX000", message: "CLARIFICATION_WORKER_UNAVAILABLE" } });
  }
});
test("rejects unsupported methods, media types and malformed JSON without Auth or CORS access", async () => {
  const f = fixture();
  assert.equal((await f.worker(new Request("http://localhost"))).status, 405);
  assert.equal((await f.worker(request(claim, { "content-type": "text/plain" }))).status, 415);
  const response = await f.worker(new Request("http://localhost", { method: "POST", headers, body: "{" }));
  assert.equal(response.status, 422); assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(f.keys, []);
});
