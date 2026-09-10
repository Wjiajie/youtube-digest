import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createPlanningWorker } from "./handler.ts";

const owner = "10000000-0000-4000-8000-000000000001", runId = "10000000-0000-4000-8000-000000000002", leaseId = "10000000-0000-4000-8000-000000000003";
const environment = { url: "http://localhost:54321", anonKey: "public-key", serviceRoleKey: "edge-admin-only", workerSecret: "independent-worker-credential-32-characters" };
const skill = { name: "blueprint-plan-path", version: "1.0.0", sha256: "a".repeat(64), instructions: "Fixed application skill" };
const claim = { operation: "claim", runId, leaseId, skill };
const headers = { "content-type": "application/json", authorization: "Bearer header.claims.signature", "x-blueprint-worker-secret": environment.workerSecret };
const request = (body: unknown = claim, extraHeaders = {}) => new Request("http://localhost/functions/v1/planning-worker", { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });

// Compile-time SDK seam check. Tests below double only external Auth/RPC clients;
// actual signature verification and Edge execution are separate integration tests.
const sdkFactory: Parameters<typeof createPlanningWorker>[1] = (url, key, options) => {
  const client = createClient(url, key, options);
  return { auth: client.auth, rpc: (name, args) => client.rpc(name, args) };
};
void sdkFactory;
function fixture(options: { claims?: Record<string, unknown>; user?: Record<string, unknown>; authError?: unknown; userError?: unknown; rpcError?: unknown } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [], keys: string[] = [], tokens: string[] = [];
  const claims = { sub: owner, role: "authenticated", is_anonymous: false, session_id: leaseId, exp: 4102444800, ...options.claims };
  const user = { id: owner, role: "authenticated", is_anonymous: false, ...options.user };
  const worker = createPlanningWorker(environment, (_url, key) => {
    keys.push(key);
    return {
      auth: {
        getClaims: async jwt => { tokens.push(jwt); return { data: { claims }, error: options.authError ?? null }; },
        getUser: async jwt => { tokens.push(jwt); return { data: { user }, error: options.userError ?? null }; },
      },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: { acquired: true, run: { id: runId, owner_id: owner } }, error: options.rpcError ?? null }; },
    };
  });
  return { worker, calls, keys, tokens };
}
test("derives owner from both verified Auth responses and invokes only claim with the original lease", async () => {
  const f = fixture(); const response = await f.worker(request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.tokens, ["header.claims.signature", "header.claims.signature"]);
  assert.deepEqual(f.keys, [environment.anonKey, environment.serviceRoleKey]);
  assert.deepEqual(f.calls, [{ name: "claim_path_planning", args: { p_owner_id: owner, p_run_id: runId, p_lease_id: leaseId, p_skill: skill } }]);
  assert.deepEqual(await response.json(), { data: { acquired: true, run: { id: runId, owner_id: owner } }, error: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("finish forwards an exact sanitized result without retries or lease substitution", async () => {
  const f = fixture(); const result = { status: "cancelled", providerMayHaveRun: true, usage: null };
  await f.worker(request({ operation: "finish", runId, leaseId, result }));
  assert.deepEqual(f.calls, [{ name: "finish_path_planning", args: { p_owner_id: owner, p_run_id: runId, p_lease_id: leaseId, p_result: result } }]);
});
test("preserves a ready result's draft and source without reconstructing or normalizing them", async () => {
  const f = fixture();
  const result = { status: "ready", providerMayHaveRun: true, usage: { inputTokens: 1, outputTokens: null, totalTokens: null },
    draft: { schemaVersion: 2, id: owner, version: 0, title: "Retained Blueprint", goals: [{ id: leaseId, title: "A goal", position: 0, stages: [] }] },
    skill, schedule: [{ nodeId: leaseId, week: 1 }], assumptions: [],
    source: { runId, briefId: leaseId, briefRevision: 1, blueprintId: owner, blueprintVersion: 0, startDate: "2026-09-10" } };
  assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 200);
  assert.deepEqual(f.calls[0].args.p_result, result);
  const invalid = fixture();
  assert.equal((await invalid.worker(request({ operation: "finish", runId, leaseId, result: { ...result, source: { ...result.source, ownerId: owner } } }))).status, 422);
  assert.deepEqual(invalid.keys, []);
});
for (const body of [{ ...claim, ownerId: owner }, { ...claim, rpc: "apply_blueprint_proposal" }, { ...claim, operation: "apply" }, { ...claim, runId: "wrong" }, { ...claim, skill: { ...skill, instructions: "😀".repeat(16001) } },
  { operation: "finish", runId, leaseId, result: { status: "unavailable", providerMayHaveRun: true, usage: null, providerError: "private provider text" } }]) {
  test(`rejects invalid/extra request fields: ${JSON.stringify(body).slice(0, 100)}`, async () => {
    const f = fixture(); assert.equal((await f.worker(request(body))).status, 422); assert.deepEqual(f.keys, []); assert.deepEqual(f.calls, []);
  });
}
for (const claims of [{ sub: runId }, { role: "service_role" }, { is_anonymous: true }, { client_id: "oauth-client" }, { client_id: null }, { session_id: null }, { session_id: owner.slice(0, 4) }, { exp: 1 }]) {
  test(`rejects untrusted user state ${JSON.stringify(claims)}`, async () => {
    const f = fixture({ claims }); assert.equal((await f.worker(request())).status, 401); assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
  });
}
test("rejects Auth verification errors and anonymous current users before creating admin client", async () => {
  for (const options of [{ authError: { status: 401 } }, { user: { is_anonymous: true } }, { user: { id: runId } }]) {
    const f = fixture(options); assert.equal((await f.worker(request())).status, 401); assert.deepEqual(f.keys, [environment.anonKey]);
  }
});
for (const boundary of ["authError", "userError"] as const) {
  test(`${boundary} distinguishes known authentication rejection from Auth unavailability`, async () => {
    for (const status of [400, 401, 403, 422]) {
      const f = fixture({ [boundary]: { status, message: "private Auth detail" } });
      const response = await f.worker(request()); assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { data: null, error: { code: "42501", message: "PATH_PLANNING_FORBIDDEN" } });
      assert.deepEqual(f.keys, [environment.anonKey]);
    }
    for (const error of [{ status: 429 }, { status: 503 }, { status: 500 }, { status: 404 }, new Error("unknown Auth detail")]) {
      const f = fixture({ [boundary]: error }); const response = await f.worker(request());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { data: null, error: { code: "XX000", message: "PATH_PLANNING_WORKER_UNAVAILABLE" } });
      assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
    }
  });
}
test("an Auth outage is not hidden by a simultaneous authentication rejection", async () => {
  const f = fixture({ authError: { status: 401 }, userError: { status: 503 } });
  assert.equal((await f.worker(request())).status, 503); assert.deepEqual(f.calls, []);
});
test("missing separate credential or malformed bearer never reaches Auth or admin", async () => {
  for (const [extra, status] of [[{ "x-blueprint-worker-secret": "" }, 403], [{ authorization: "Bearer forged" }, 401]] as const) {
    const f = fixture(); assert.equal((await f.worker(request(claim, extra))).status, status); assert.deepEqual(f.keys, []);
  }
});
test("rejects short, reused admin/public, and JWT-looking configured worker credentials", async () => {
  for (const workerSecret of ["short", environment.serviceRoleKey, environment.anonKey, `sb_secret_${"a".repeat(40)}`, `${"a".repeat(32)}.payload.signature`]) {
    let created = false;
    const worker = createPlanningWorker({ ...environment, workerSecret }, () => { created = true; throw new Error(); });
    assert.equal((await worker(request())).status, 503); assert.equal(created, false);
  }
});
test("bounds actual body bytes, not just declared Content-Length", async () => {
  const f = fixture();
  assert.equal((await f.worker(request({ ...claim, padding: "x".repeat(8 * 1024 * 1024) }))).status, 413);
  assert.equal((await f.worker(request(claim, { "content-length": String(8 * 1024 * 1024 + 1) }))).status, 413);
  assert.deepEqual(f.keys, []);
});
test("only emits allowlisted database errors and never relays details or raw provider text", async () => {
  const known = fixture({ rpcError: { code: "P0002", message: "PATH_PLANNING_NOT_FOUND", details: "private value" } });
  const missing = await known.worker(request()); assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { data: null, error: { code: "P0002", message: "PATH_PLANNING_NOT_FOUND" } });
  const unknown = fixture({ rpcError: { code: "22023", message: "private provider text" } });
  const failed = await unknown.worker(request()); assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { data: null, error: { code: "XX000", message: "PATH_PLANNING_WORKER_UNAVAILABLE" } });
});
test("rejects methods and non-JSON media types without creating any clients", async () => {
  const f = fixture();
  assert.equal((await f.worker(new Request("http://localhost"))).status, 405);
  assert.equal((await f.worker(request(claim, { "content-type": "text/plain" }))).status, 415);
  assert.deepEqual(f.keys, []);
});
