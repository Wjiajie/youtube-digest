import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createResourceWorker } from "./handler.ts";

const owner = "10000000-0000-4000-8000-000000000001", runId = "10000000-0000-4000-8000-000000000002", leaseId = "10000000-0000-4000-8000-000000000003";
const environment = { url: "http://localhost:54321", anonKey: "public-key", serviceRoleKey: "edge-admin-only", workerSecret: "independent-resource-credential-32-characters" };
const headers = { "content-type": "application/json", authorization: "Bearer header.claims.signature", "x-blueprint-worker-secret": environment.workerSecret };
const claim = { operation: "claim", runId, leaseId, skill: null };
const request = (body: unknown = claim, extra = {}) => new Request("http://localhost/functions/v1/resource-worker", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
const sdkFactory: Parameters<typeof createResourceWorker>[1] = (url, key, options) => {
  const client = createClient(url, key, options);
  return { auth: client.auth, rpc: (name, args) => client.rpc(name, args) };
};
void sdkFactory;
function fixture(options: { claims?: Record<string, unknown>; user?: Record<string, unknown>; authError?: unknown; rpcError?: unknown; forbidden?: string[] } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [], keys: string[] = [], tokens: string[] = [];
  const worker = createResourceWorker(environment, (_url, key) => {
    keys.push(key);
    return {
      auth: {
        getClaims: async jwt => { tokens.push(jwt); return { data: { claims: { sub: owner, role: "authenticated", is_anonymous: false, session_id: leaseId, exp: 4102444800, ...options.claims } }, error: options.authError ?? null }; },
        getUser: async jwt => { tokens.push(jwt); return { data: { user: { id: owner, role: "authenticated", is_anonymous: false, ...options.user } }, error: null }; },
      },
      rpc: async (name, args) => { calls.push({ name, args }); return { data: { acquired: true, run: { id: runId, owner_id: owner } }, error: options.rpcError ?? null }; },
    };
  }, options.forbidden);
  return { worker, calls, keys, tokens };
}
test("resource claim derives the owner from verified Auth and preserves the exact lease", async () => {
  const f = fixture(); const response = await f.worker(request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.tokens, ["header.claims.signature", "header.claims.signature"]);
  assert.deepEqual(f.keys, [environment.anonKey, environment.serviceRoleKey]);
  assert.deepEqual(f.calls, [{ name: "claim_resource_run", args: { p_owner_id: owner, p_run_id: runId, p_lease_id: leaseId, p_skill: null } }]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

const source = { blueprintId: owner, blueprintVersion: 3, nodeId: leaseId, checkedAt: "2026-09-10T03:00:00.000Z" };
const requests = { catalogMayHaveRun: true, transcriptVideoIds: ["abcdefghijk"] };
const video = { videoId: "abcdefghijk", title: "Research basics", description: "A captioned lesson", channelId: "channel", channelTitle: "Learning",
  publishedAt: "2025-01-02T00:00:00Z", durationSeconds: 300, audioLanguage: "en", defaultLanguage: null, captionAvailable: true,
  privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: false, allowedRegions: null,
  blockedRegions: [], ageRestricted: false, statistics: { viewCount: "12345678901234567890", likeCount: null, commentCount: "0" } };
const candidate = { video, url: "https://www.youtube.com/watch?v=abcdefghijk", transcript: { status: "pending", jobId: "owned-job" },
  languageFallback: null, eligibleForMatching: false, matching: "not_evaluated" };
const discovery = { status: "discovered", source, requests, candidates: [candidate], rejected: [], uninspectedVideoIds: [] };
test("discovery finish preserves canonical video metadata and existing pending job without normalization", async () => {
  const f = fixture(); const response = await f.worker(request({ operation: "finish", runId, leaseId, result: discovery }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [{ name: "finish_resource_run", args: { p_owner_id: owner, p_run_id: runId, p_lease_id: leaseId, p_result: discovery } }]);
});
const resourceSkill = { name: "blueprint-match-resources", version: "1.0.0", sha256: "a".repeat(64) };
const match = { status: "matched", reviewRequired: true, providerMayHaveRun: true, usage: { inputTokens: 10, outputTokens: null, totalTokens: null },
  source: { ...source, evidenceSha256: "b".repeat(64) }, skill: resourceSkill, summary: "The caption addresses the node.",
  assessments: [{ videoId: "abcdefghijk", role: "recommended", relevance: "The topic fits.", levelFit: "Starts with basics.", languageFit: "English captions.",
    timeFit: "Five minutes.", freshness: "Foundational material.", limitations: ["Requires practice."], evidence: [{ segmentIndex: 2, quote: "Observe the example.", offsetMs: 2500.25 }] }],
  coverage: [{ videoId: "abcdefghijk", totalSegments: 30, sampledSegments: 24, textTruncated: true }] };
test("matching finish preserves identity, token nulls, quoted evidence and fractional timestamp exactly", async () => {
  const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result: match }))).status, 200);
  assert.deepEqual(f.calls[0], { name: "finish_resource_run", args: { p_owner_id: owner, p_run_id: runId, p_lease_id: leaseId, p_result: match } });
});
test("terminal failure and no-evidence receipts preserve only optional canonical request and usage fields", async () => {
  for (const result of [{ status: "cancelled" }, { status: "unavailable", requests }, { status: "no_evidence", providerMayHaveRun: false, usage: null },
    { status: "timed_out", providerMayHaveRun: true, usage: { inputTokens: null, outputTokens: null, totalTokens: null } }]) {
    const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 200);
    assert.deepEqual(f.calls[0].args.p_result, result);
  }
});
test("native captions retain original text, actual language and fractional offsets", async () => {
  const result = { ...discovery, candidates: [{ ...candidate, transcript: { status: "ready", language: "zh-Hans", availableLanguages: ["en", "zh-Hans"],
    segments: [{ text: "  保留原文与空格  ", offset: 0.25, duration: 1000.5, lang: "zh-Hans" }] }, languageFallback: true, eligibleForMatching: true }] };
  const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 200);
  assert.deepEqual(f.calls[0].args.p_result, result);
});
test("no-candidate and all-rejected match outcomes remain valid review receipts", async () => {
  for (const result of [{ status: "no_candidates", source, requests, rejected: [{ videoId: "abcdefghijk", reason: "region_restricted" }] },
    { ...match, status: "no_match", assessments: [{ ...match.assessments[0], role: "rejected" }] }]) {
    const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 200);
    assert.deepEqual(f.calls[0].args.p_result, result);
  }
});
test("matching claim accepts only its versioned application Skill, with no owner or RPC substitution", async () => {
  const skill = { ...resourceSkill, instructions: "Fixed application Skill" };
  const f = fixture(); assert.equal((await f.worker(request({ ...claim, skill }))).status, 200);
  assert.deepEqual(f.calls[0].args.p_skill, skill);
  for (const body of [{ ...claim, ownerId: owner }, { ...claim, rpc: "apply_blueprint_proposal" }, { ...claim, operation: "search" },
    { ...claim, skill: { ...skill, name: "blueprint-plan-path" } }, { ...claim, skill: { ...skill, instructions: "😀".repeat(16001) } },
    { ...claim, skill: resourceSkill }]) {
    const denied = fixture(); assert.equal((await denied.worker(request(body))).status, 422); assert.deepEqual(denied.keys, []);
  }
});
const invalidResults: [string, unknown][] = [
  ["unknown outcome", { status: "ready" }],
  ["raw provider body", { status: "unavailable", body: { token: "private-provider-marker" } }],
  ["nested request error", { status: "unavailable", requests: { ...requests, providerError: "private-provider-marker" } }],
  ["invalid token usage", { status: "timed_out", usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } }],
  ["extra source field", { ...discovery, source: { ...source, ownerId: owner } }],
  ["invalid source calendar", { ...discovery, source: { ...source, checkedAt: "2026-02-30T00:00:00Z" } }],
  ["unknown metadata body", { ...discovery, candidates: [{ ...candidate, video: { ...video, rawResponse: "private-provider-marker" } }] }],
  ["numeric rounded statistics", { ...discovery, candidates: [{ ...candidate, video: { ...video, statistics: { ...video.statistics, viewCount: 123 } } }] }],
  ["unbounded count", { ...discovery, candidates: [{ ...candidate, video: { ...video, statistics: { ...video.statistics, viewCount: "1".repeat(129) } } }] }],
  ["arbitrary resource URL", { ...discovery, candidates: [{ ...candidate, url: "https://untrusted.example/private" }] }],
  ["pending path injection", { ...discovery, candidates: [{ ...candidate, transcript: { status: "pending", jobId: "../foreign" } }] }],
  ["duplicate candidate", { ...discovery, candidates: [candidate, candidate] }],
  ["job assigned to two videos", { ...discovery, candidates: [candidate, { ...candidate, video: { ...video, videoId: "lmnopqrstuv" }, url: "https://www.youtube.com/watch?v=lmnopqrstuv" }] }],
  ["pending falsely eligible", { ...discovery, candidates: [{ ...candidate, eligibleForMatching: true }] }],
  ["too many requested captions", { ...discovery, requests: { ...requests, transcriptVideoIds: Array(4).fill("abcdefghijk") } }],
  ["transcript opaque fields", { ...discovery, candidates: [{ ...candidate, transcript: { status: "unavailable", details: "private-provider-marker" } }] }],
  ["oversized match summary", { ...match, summary: "x".repeat(601) }],
  ["unknown match Skill field", { ...match, skill: { ...resourceSkill, instructions: "private" } }],
  ["invalid evidence hash", { ...match, source: { ...match.source, evidenceSha256: "not-a-hash" } }],
  ["citation extra provider field", { ...match, assessments: [{ ...match.assessments[0], evidence: [{ ...match.assessments[0].evidence[0], providerText: "private" }] }] }],
  ["citation negative offset", { ...match, assessments: [{ ...match.assessments[0], evidence: [{ ...match.assessments[0].evidence[0], offsetMs: -1 }] }] }],
  ["unbounded coverage", { ...match, coverage: [{ ...match.coverage[0], sampledSegments: 25 }] }],
];
for (const [label, result] of invalidResults) test(`rejects ${label} before Auth or privileged persistence`, async () => {
  const f = fixture(); assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 422);
  assert.deepEqual(f.keys, []); assert.deepEqual(f.calls, []);
});
test("ready transcript bounds text, segments, language and numeric timestamp overflow", async () => {
  const captions = { status: "ready", language: "en", availableLanguages: ["en"], segments: [{ text: "caption", offset: 0, duration: 1000 }] };
  for (const transcript of [{ ...captions, segments: [] }, { ...captions, segments: [{ text: " ", offset: 0, duration: 1000 }] },
    { ...captions, segments: [{ text: "caption", offset: Number.MAX_SAFE_INTEGER, duration: 1 }] },
    { ...captions, segments: [{ text: "caption", offset: 0, duration: 1000, providerSecret: "private" }] },
    { ...captions, language: "not language" }]) {
    const f = fixture(); const result = { ...discovery, candidates: [{ ...candidate, transcript, languageFallback: false, eligibleForMatching: true }] };
    assert.equal((await f.worker(request({ operation: "finish", runId, leaseId, result }))).status, 422); assert.deepEqual(f.keys, []);
  }
});
test("separate resource credential cannot reuse configured worker or provider secrets", async () => {
  for (const forbidden of [[environment.workerSecret], [` ${environment.workerSecret} `]]) {
    const f = fixture({ forbidden }); assert.equal((await f.worker(request())).status, 503); assert.deepEqual(f.keys, []);
  }
  const distinct = fixture({ forbidden: ["", " ", "different-worker-credential-at-least-32-characters"] });
  assert.equal((await distinct.worker(request())).status, 200);
  for (const workerSecret of ["short", environment.anonKey, environment.serviceRoleKey, `sb_secret_${"a".repeat(40)}`, `${"a".repeat(32)}.payload.signature`]) {
    let created = false;
    const worker = createResourceWorker({ ...environment, workerSecret }, () => { created = true; throw new Error(); });
    assert.equal((await worker(request())).status, 503); assert.equal(created, false);
  }
});
test("wrong credential and malformed bearer do not initiate Auth", async () => {
  for (const [extra, status] of [[{ "x-blueprint-worker-secret": "wrong" }, 403], [{ authorization: "Bearer forged" }, 401]] as const) {
    const f = fixture(); assert.equal((await f.worker(request(claim, extra))).status, status); assert.deepEqual(f.keys, []);
  }
});
test("verified identities must agree and exclude OAuth and anonymous sessions", async () => {
  for (const options of [{ claims: { sub: runId } }, { claims: { client_id: "extension" } }, { claims: { client_id: null } },
    { claims: { is_anonymous: true } }, { claims: { session_id: null } }, { claims: { exp: 1 } }, { user: { is_anonymous: true } }]) {
    const f = fixture(options); assert.equal((await f.worker(request())).status, 401);
    assert.deepEqual(f.keys, [environment.anonKey]); assert.deepEqual(f.calls, []);
  }
});
test("Auth outage is sanitized and never constructs a privileged client", async () => {
  const f = fixture({ authError: { status: 503, details: "private Auth text" } }); const response = await f.worker(request());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { data: null, error: { code: "XX000", message: "RESOURCE_WORKER_UNAVAILABLE" } });
  assert.deepEqual(f.keys, [environment.anonKey]);
});
test("resource database errors are narrow and unknown details never leave the handler", async () => {
  for (const [code, message, status] of [["P0002", "RESOURCE_NOT_FOUND", 404], ["22023", "RESOURCE_SOURCE_CONSUMED", 422],
    ["22023", "RESOURCE_COMPLETION_REUSED", 422], ["P0001", "RESOURCE_QUOTA_EXHAUSTED", 409]] as const) {
    const f = fixture({ rpcError: { code, message, details: "private database detail" } }); const response = await f.worker(request());
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { data: null, error: { code, message } });
  }
  const f = fixture({ rpcError: { code: "22023", message: "private SQL body" } }); const response = await f.worker(request());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { data: null, error: { code: "XX000", message: "RESOURCE_WORKER_UNAVAILABLE" } });
});
test("methods, media type, actual body limit and UTF-8 remain guarded by the shared transport", async () => {
  const f = fixture();
  assert.equal((await f.worker(new Request("http://localhost"))).status, 405);
  assert.equal((await f.worker(request(claim, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await f.worker(request({ ...claim, extra: "x".repeat(8 * 1024 * 1024) }))).status, 413);
  assert.equal((await f.worker(request(claim, { "content-length": String(8 * 1024 * 1024 + 1) }))).status, 413);
  assert.equal((await f.worker(new Request("http://localhost", { method: "POST", headers, body: new Uint8Array([0xff]) }))).status, 422);
  assert.deepEqual(f.keys, []);
});
