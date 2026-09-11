import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET, POST } from "./route";
import { GET as read, POST as cancel } from "./[runId]/route";
import { GET as webFind, POST as webStart } from "../../../translations/runs/route";
import { GET as webRead, POST as webCancel } from "../../../translations/runs/[runId]/route";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));

const owner = "fd810000-0000-4000-8000-000000000001";
const bindingId = "fd810000-0000-4000-8000-000000000002";
const sourceRunId = "fd810000-0000-4000-8000-000000000003";
const runId = "fd810000-0000-4000-8000-000000000004";
const extension = "translation-http-extension";
const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: owner, client_id: extension })).toString("base64url"), "fixture"].join(".");
const context = { accountId: owner, bindingId, videoId: "abcdefghijk", sourceRunId, offset: "20", targetLanguage: "zh-Hans" };
const paths: string[] = [];
let persisted: unknown;
let authStatus: number;
let located: string | null;
let source: unknown;
function jwt(clientId?: unknown) { return ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: owner,
  ...(clientId === undefined ? {} : { client_id: clientId }) })).toString("base64url"), "fixture"].join("."); }
function signIn(clientId?: unknown) {
  cookieJar.push({ name: "sb-translation-auth-token", value: `base64-${Buffer.from(JSON.stringify({ access_token: jwt(clientId), refresh_token: "fixture-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: owner } })).toString("base64url")}` });
}
function extensionRequest(body?: unknown, authorization = `Bearer ${token}`, query: Record<string, string> = context) {
  return new NextRequest(`https://blueprint.example.test/api/v1/translations/runs${body === undefined ? `?${new URLSearchParams(query)}` : ""}`, {
    method: body === undefined ? "GET" : "POST", headers: { authorization, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function queuedRun() {
  return { id: runId, owner_id: owner, blueprint_id: owner, node_id: owner, binding_id: bindingId, video_id: "abcdefghijk",
    source_run_id: sourceRunId, page_offset: 20, target_language: "zh-Hans", status: "queued", created_at: "2026-09-11T00:00:00Z",
    expires_at: "2026-09-11T00:02:00Z", source_started_at: "2026-09-10T00:00:00Z", content_expires_at: "2026-09-12T00:00:00Z",
    retention_policy_ref: "fixture-only", cleared_at: null, clear_reason: null, model: null, skill: null, result: null,
    input_page: { status: "ready", ownerId: owner, context: { bindingId, nodeId: owner, nodeTitle: "实践", goalId: owner, goalTitle: "摄影", videoId: "abcdefghijk" },
      observedAt: "2026-09-11T00:00:00Z", sourceRunId, sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
      contentExpiresAt: "2026-09-12T00:00:00Z", title: "Light", language: "en", offset: 20, totalSegments: 21,
      segments: [{ text: "Observe the light.", offsetMs: 300000, durationMs: 10000 }] } };
}
beforeEach(() => {
  paths.length = 0;
  persisted = null;
  authStatus = 200; cookieJar.length = 0; located = null; source = null;
  vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://translation.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-fixture");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extension);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname; paths.push(path);
    if (path === "/auth/v1/user") return authStatus === 200 ? Response.json({ id: owner, role: "authenticated", is_anonymous: false })
      : Response.json({ message: "private Auth detail" }, { status: authStatus });
    if (path === "/rest/v1/rpc/find_translation_run") {
      expect([`Bearer ${token}`, `Bearer ${jwt()}`]).toContain(request.headers.get("authorization"));
      expect(await request.json()).toEqual({ p_request: { bindingId, videoId: "abcdefghijk", sourceRunId, offset: 20, targetLanguage: "zh-Hans" } });
      return Response.json({ run_id: located });
    }
    if (path === "/rest/v1/rpc/read_translation_run" || path === "/rest/v1/rpc/cancel_translation_run") {
      expect([`Bearer ${token}`, `Bearer ${jwt()}`]).toContain(request.headers.get("authorization"));
      expect(await request.json()).toEqual({ p_run_id: runId });
      return persisted ? Response.json(persisted) : Response.json({ code: "P0002", message: "private receipt detail" }, { status: 404 });
    }
    if (path === "/rest/v1/rpc/begin_translation_run") return Response.json(persisted);
    if (path === "/rest/v1/rpc/read_learning_transcript") return Response.json(source);
    if (path === "/functions/v1/translation-worker") {
      expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect((await request.json()).operation).toBe("claim");
      return Response.json({ data: null, error: { code: "42501", message: "private Worker detail" } }, { status: 403 });
    }
    throw new Error("Unexpected external request");
  });
});
test("explicit extension start forwards the verified bearer to the independent Worker without refreshing a Cookie session", async () => {
  vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "fixture-model-key");
  vi.stubEnv("BLUEPRINT_TRANSLATION_WORKER_SECRET", "independent-translation-worker-fixture-secret");
  persisted = queuedRun();
  const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/translations/runs", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ...context, offset: 20, runId }) }));
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: "forbidden" });
  expect(paths).toEqual(["/auth/v1/user", "/rest/v1/rpc/begin_translation_run", "/functions/v1/translation-worker"]);
});
test("the exact extension can recover and explicitly cancel while generation is disabled", async () => {
  vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "false"); vi.stubEnv("DEEPSEEK_API_KEY", "");
  const url = `https://blueprint.example.test/api/v1/translations/runs/${runId}`;
  for (const response of [
    await read(new NextRequest(`${url}?accountId=${owner}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ runId }) }),
    await cancel(new NextRequest(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ operation: "cancel", accountId: owner }) }), { params: Promise.resolve({ runId }) }),
  ]) {
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ ok: false, code: "not_found" });
  }
  expect(paths).toEqual(["/auth/v1/user", "/rest/v1/rpc/read_translation_run", "/auth/v1/user", "/rest/v1/rpc/cancel_translation_run"]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("the exact verified extension can find its current page without starting a translation", async () => {
  const response = await GET(new NextRequest(`https://blueprint.example.test/api/v1/translations/runs?${new URLSearchParams(context)}`, {
    headers: { authorization: `Bearer ${token}` },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, run: null });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(paths).toEqual(["/auth/v1/user", "/rest/v1/rpc/find_translation_run"]);
});

test.each([undefined, "Basic abc", "Bearer", "Bearer ", "bearer abc", "Bearer a b"])("extension endpoints never fall back to a valid Web cookie for malformed or missing authorization: %s", async authorization => {
  signIn();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== undefined) headers.authorization = authorization;
  const url = "https://blueprint.example.test/api/v1/translations/runs";
  const responses = [await GET(new NextRequest(`${url}?${new URLSearchParams(context)}`, { headers })),
    await POST(new NextRequest(url, { method: "POST", headers, body: JSON.stringify({ ...context, offset: 20, runId }) })),
    await read(new NextRequest(`${url}/${runId}?accountId=${owner}`, { headers }), { params: Promise.resolve({ runId }) }),
    await cancel(new NextRequest(`${url}/${runId}`, { method: "POST", headers, body: JSON.stringify({ operation: "cancel", accountId: owner }) }), { params: Promise.resolve({ runId }) })];
  for (const response of responses) { expect(response.status).toBe(401); expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" }); }
  expect(paths).toEqual([]);
});

test.each([undefined, null, "unknown-client", 42, [extension], { client_id: extension }])("a verified user with an unapproved client claim cannot access translations: %j", async clientId => {
  const response = await GET(extensionRequest(undefined, `Bearer ${jwt(clientId)}`));
  expect(response.status).toBe(401); expect(paths).toEqual(["/auth/v1/user"]);
});

test("an unconfigured OAuth client cannot access translations", async () => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "");
  expect((await GET(extensionRequest())).status).toBe(401); expect(paths).toEqual(["/auth/v1/user"]);
});

test.each([[401, 401, "unauthenticated"], [403, 401, "unauthenticated"], [429, 503, "unavailable"], [503, 503, "unavailable"]] as const)("the external Auth %s classification stays private and prevents persistence", async (status, expected, code) => {
  authStatus = status;
  const response = await GET(extensionRequest()); expect(response.status).toBe(expected);
  expect(await response.json()).toEqual({ ok: false, code }); expect(paths).toEqual(["/auth/v1/user"]);
});

test("stale account commands cannot find, read, start or cancel the signed-in owner's translations", async () => {
  const wrongOwner = "fd810000-0000-4000-8000-000000000099";
  const responses = [await GET(extensionRequest(undefined, `Bearer ${token}`, { ...context, accountId: wrongOwner })),
    await POST(extensionRequest({ ...context, accountId: wrongOwner, offset: 20, runId })),
    await read(new NextRequest(`https://blueprint.example.test/api/v1/translations/runs/${runId}?accountId=${wrongOwner}`, {
      headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ runId }) }),
    await cancel(extensionRequest({ operation: "cancel", accountId: wrongOwner }), { params: Promise.resolve({ runId }) })];
  for (const response of responses) { expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: "forbidden" }); }
  expect(paths.every(path => path === "/auth/v1/user")).toBe(true);
});

test("lookup rejects duplicate or unknown parameters and explicit start rejects unknown fields or nonnumeric offsets", async () => {
  for (const suffix of ["&offset=20", "&unknown=1", "&runId=" + runId]) {
    const request = extensionRequest();
    expect((await GET(new NextRequest(request.url + suffix, { headers: request.headers }))).status).toBe(422);
  }
  for (const body of [{ ...context, runId }, { ...context, offset: 20, runId, transcript: "do not trust" }, { ...context, offset: 1, runId }])
    expect((await POST(extensionRequest(body))).status).toBe(422);
  expect(paths.every(path => path === "/auth/v1/user")).toBe(true);
});

test("only an explicit start needs generation configuration; bodies have strict media type and actual byte bounds", async () => {
  const disabled = await POST(extensionRequest({ ...context, offset: 20, runId }));
  expect(disabled.status).toBe(503); expect(await disabled.json()).toEqual({ ok: false, code: "disabled" });
  for (const [body, contentType, status] of [["{broken", "application/json", 422], ["{}", "text/plain", 422], ["中".repeat(11000), "application/json", 413]] as const) {
    const response = await POST(new NextRequest("https://blueprint.example.test/api/v1/translations/runs", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": contentType, "content-length": "1" }, body }));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
  }
  expect(paths.every(path => path === "/auth/v1/user")).toBe(true);
});

test("legacy Web routes still reject every Authorization header and cross-origin writes before Auth", async () => {
  signIn(); const request = extensionRequest();
  const responses = [await webFind(request), await webRead(request, { params: Promise.resolve({ runId }) }),
    await webStart(extensionRequest({ ...context, offset: 20, runId })), await webCancel(extensionRequest({ operation: "cancel", accountId: owner }), { params: Promise.resolve({ runId }) }),
    await webStart(new Request("https://blueprint.example.test/api/translations/runs", { method: "POST", headers: { host: "blueprint.example.test", origin: "https://other.example.test" }, body: "{}" }))];
  for (const response of responses) expect(response.status).toBe(403);
  expect(paths).toEqual([]);
});

test("extension recovery never enables cross-origin browser access headers", async () => {
  const response = await GET(extensionRequest());
  expect(response.status).toBe(200); expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
});

test.each([extension, "unknown-client", null, 0, {}])("an OAuth token stored in a Cookie cannot use the legacy Web-only routes: %j", async clientId => {
  signIn(clientId);
  const headers = { host: "blueprint.example.test", origin: "https://blueprint.example.test", "content-type": "application/json" };
  const url = "https://blueprint.example.test/api/translations/runs";
  const responses = [await webFind(new Request(`${url}?${new URLSearchParams(context)}`)),
    await webRead(new Request(`${url}/${runId}?accountId=${owner}`), { params: Promise.resolve({ runId }) }),
    await webStart(new Request(url, { method: "POST", headers, body: JSON.stringify({ ...context, offset: 20, runId }) })),
    await webCancel(new Request(`${url}/${runId}`, { method: "POST", headers, body: JSON.stringify({ operation: "cancel", accountId: owner }) }), { params: Promise.resolve({ runId }) })];
  for (const response of responses) { expect(response.status).toBe(403); expect(await response.json()).toEqual({ ok: false, code: "forbidden" }); }
  expect(paths.every(path => path === "/auth/v1/user")).toBe(true);
});

test("a verified ordinary Web Cookie still finds and recovers translations while generation is disabled", async () => {
  signIn();
  const found = await webFind(new Request(`https://blueprint.example.test/api/translations/runs?${new URLSearchParams(context)}`));
  expect(found.status).toBe(200); expect(await found.json()).toEqual({ ok: true, run: null });
  const response = await webRead(new Request(`https://blueprint.example.test/api/translations/runs/${runId}?accountId=${owner}`), { params: Promise.resolve({ runId }) });
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ ok: false, code: "not_found" });
});

test("Web and extension read the same fresh original-verified translation projection without private execution fields", async () => {
  const row = queuedRun(), instructions = "Translate only the original caption.";
  const result = { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 20, translation: "观察光线。" }] };
  persisted = { ...row, status: "ready", result, model: "deepseek-flash",
    skill: { name: "blueprint-translate-transcript", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") } };
  source = row.input_page; located = runId; signIn();
  const responses = [await GET(extensionRequest()), await webFind(new Request(`https://blueprint.example.test/api/translations/runs?${new URLSearchParams(context)}`)),
    await read(new NextRequest(`https://blueprint.example.test/api/v1/translations/runs/${runId}?accountId=${owner}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ runId }) })];
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, run: { runId, accountId: owner, status: "ready",
      context: { bindingId, videoId: "abcdefghijk", sourceRunId, offset: 20 }, targetLanguage: "zh-Hans",
      contentExpiresAt: "2026-09-12T00:00:00Z", observedAt: "2026-09-11T00:00:00Z", result } });
  }
  source = { ...row.input_page, segments: [{ text: "Changed original.", offsetMs: 300000, durationMs: 10000 }] };
  const changed = await GET(extensionRequest()); expect(changed.status).toBe(503); expect(await changed.json()).toEqual({ ok: false, code: "unavailable" });
  expect(paths.every(path => !path.includes("begin") && !path.includes("functions") && !path.includes("completions"))).toBe(true);
});

test("explicit cancellation returns a bodyless receipt, not a generation or removal", async () => {
  persisted = { ...queuedRun(), status: "cancelled", result: { status: "cancelled", providerMayHaveRun: false, usage: null } };
  const response = await cancel(extensionRequest({ operation: "cancel", accountId: owner }), { params: Promise.resolve({ runId }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, runId, status: "cancelled" });
  expect(paths).toEqual(["/auth/v1/user", "/rest/v1/rpc/cancel_translation_run"]);
});

test("a timed-out translation lookup aborts persistence and returns no material", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const originalFetch = globalThis.fetch;
  let requested = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (!request.url.includes("/rpc/find_translation_run")) return originalFetch(input, init);
    requested = true;
    return new Promise<Response>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  });
  let settled = false;
  const pending = GET(extensionRequest()).then(response => { settled = true; return response; });
  await vi.waitFor(() => expect(requested).toBe(true)); deadline.abort();
  expect(timeout).toHaveBeenCalledWith(10_000);
  await vi.waitFor(() => expect(settled).toBe(true));
  const response = await pending;
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
});

test.each([[400, 401, "unauthenticated"], [429, 503, "unavailable"], [503, 503, "unavailable"], [200, 403, "forbidden"]] as const)(
  "Web start still refreshes after a slow body and validates the refreshed credential: Auth %s", async (status, expectedStatus, code) => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now); signIn();
    vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "fixture-model-key");
    vi.stubEnv("BLUEPRINT_TRANSLATION_WORKER_SECRET", "independent-translation-worker-fixture-secret");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init), path = new URL(request.url).pathname;
      paths.push(path);
      if (path === "/auth/v1/user") return Response.json({ id: owner, role: "authenticated", is_anonymous: false });
      if (path === "/auth/v1/token") {
        now += 31_000;
        return status === 200 ? Response.json({ access_token: token, refresh_token: "fixture-refresh", expires_in: 3600,
          token_type: "bearer", user: { id: owner } }) : Response.json({ message: "private refresh detail" }, { status });
      }
      throw new Error("Unexpected external request");
    });
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      now += 3_700_000;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...context, offset: 20, runId }))); controller.close();
    } }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
      headers: { host: "blueprint.example.test", origin: "https://blueprint.example.test", "content-type": "application/json" } };
    const response = await webStart(new Request("https://blueprint.example.test/api/translations/runs", init));
    expect(response.status).toBe(expectedStatus); expect(await response.json()).toEqual({ ok: false, code });
    expect(paths).toEqual(["/auth/v1/user", "/auth/v1/token"]);
  },
);
