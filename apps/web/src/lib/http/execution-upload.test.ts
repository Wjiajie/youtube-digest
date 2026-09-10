import { afterEach, expect, it, vi } from "vitest";
import { POST as plan } from "../../app/api/planning/runs/route";
import { POST as clarify } from "../../app/api/clarification/turns/route";
import { POST as resources } from "../../app/api/resources/runs/route";

const cookieFixture = vi.hoisted(() => ({ values: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieFixture.values, set: () => {} }) }));
const id = "10000000-0000-4000-8000-000000000001";
const entries = [
  { name: "planning", post: plan, limit: 2048, command: { accountId: id, runId: id, briefId: id, expectedBriefRevision: 1, expectedBlueprintVersion: 0, startDate: "2026-09-10" } },
  { name: "clarification", post: clarify, limit: 65536, command: { accountId: id, turnId: id, sessionId: id, expectedRevision: 1, message: "想学摄影" } },
  { name: "resources", post: resources, limit: 32768, command: { accountId: id, kind: "match", runId: id, sourceRunId: id } },
];
afterEach(() => { cookieFixture.values = []; vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function login() {
  const user = { id, role: "authenticated", is_anonymous: false }, paths: string[] = [];
  cookieFixture.values = [{ name: "sb-upload-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: "fixture-token", refresh_token: "fixture-refresh", expires_at: Date.now() / 1000 + 600, user,
  })).toString("base64url")}` }];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://upload.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-fixture");
  for (const name of ["BLUEPRINT_PLANNING_ENABLED", "BLUEPRINT_CLARIFICATION_ENABLED", "BLUEPRINT_RESOURCES_ENABLED", "BLUEPRINT_RESOURCE_ADOPTION_ENABLED"]) vi.stubEnv(name, "false");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path === "/auth/v1/user") return Response.json(user);
    throw new Error("Unexpected external request");
  });
  return paths;
}
function request(body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, signal, duplex: "half",
    headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" } };
  return new Request("https://blueprint.example/api/execution", init);
}

it.each(entries)("$name rejects invalid UTF-8 immediately even when the uploader stops sending", async ({ post }) => {
  vi.useFakeTimers();
  const paths = login();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(Uint8Array.of(0xff)); }, cancel: () => new Promise(() => {}) });
  let response: Response | undefined;
  const pending = post(request(body)).then(value => { response = value; });
  await vi.advanceTimersByTimeAsync(1);
  try {
    expect(response?.status).toBe(422); expect(await response?.json()).toEqual({ ok: false, code: "invalid" });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(paths).toEqual(["/auth/v1/user"]);
  } finally { if (!response) stream.close(); await pending; }
});

it.each(entries)("$name stops reading promptly when its authenticated sender aborts", async ({ post }) => {
  vi.useFakeTimers(); const paths = login(), abort = new AbortController();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, cancel: () => Promise.reject(new Error("PRIVATE_CANCEL_REASON")) });
  let response: Response | undefined;
  const pending = post(request(body, abort.signal)).then(value => { response = value; });
  await vi.advanceTimersByTimeAsync(1); abort.abort("PRIVATE_ABORT_REASON");
  await vi.advanceTimersByTimeAsync(1);
  try {
    expect(response?.status).toBe(422); expect(await response?.json()).toEqual({ ok: false, code: "invalid" });
    expect(paths).toEqual(["/auth/v1/user"]);
  } finally { if (!response) stream.close(); await pending; }
});

it.each(entries)("$name enforces its actual byte limit, not a claimed Content-Length", async ({ post, limit, command }) => {
  const paths = login(), bytes = new TextEncoder().encode(JSON.stringify(command));
  const exact = new Uint8Array(limit).fill(32); exact.set(bytes);
  const accepted = await post(request(exact));
  expect(accepted.status).toBe(503); expect(await accepted.json()).toEqual({ ok: false, code: "disabled" });
  const over = new Uint8Array(limit + 1).fill(32); over.set(bytes);
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(over); }, cancel: () => new Promise(() => {}) });
  const input = request(body); input.headers.set("content-length", "1");
  const rejected = await post(input);
  expect(rejected.status).toBe(413); expect(await rejected.json()).toEqual({ ok: false, code: "invalid" });
  expect(rejected.headers.get("cache-control")).toBe("private, no-store");
  expect(paths).toEqual(["/auth/v1/user", "/auth/v1/user"]);
});

it.each(entries)("$name accepts a valid command delivered one byte per chunk", async ({ post, command }) => {
  const paths = login(), bytes = new TextEncoder().encode(JSON.stringify(command));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } });
  const response = await post(request(body));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "disabled" });
  expect(paths).toEqual(["/auth/v1/user"]);
});

it.each(entries)("$name does not extend its absolute deadline for a trickling sender", async ({ post }) => {
  vi.useFakeTimers(); const paths = login();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  let response: Response | undefined;
  const pending = post(request(body)).then(value => { response = value; });
  await vi.advanceTimersByTimeAsync(0);
  for (let second = 0; second < 4; second++) {
    await vi.advanceTimersByTimeAsync(1000); stream.enqueue(Uint8Array.of(32));
  }
  await vi.advanceTimersByTimeAsync(999); expect(response).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  try { expect(response?.status).toBe(408); expect(paths).toEqual(["/auth/v1/user"]); }
  finally { if (!response) stream.close(); await pending; }
});

it.each(entries)("$name never executes a complete body from an already aborted request", async ({ post, command }) => {
  const paths = login(), abort = new AbortController(); abort.abort("PRIVATE_REASON");
  const response = await post(request(new TextEncoder().encode(JSON.stringify(command)), abort.signal));
  expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
  expect(paths).toEqual(["/auth/v1/user"]);
});

it.each(entries)("$name rejects empty, malformed JSON and incomplete UTF-8 without execution", async ({ post }) => {
  const paths = login();
  for (const body of [new Uint8Array(), new TextEncoder().encode("{"), Uint8Array.of(34, 0xe4, 0xb8)]) {
    const response = await post(request(body));
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
  }
  expect(paths).toEqual(["/auth/v1/user", "/auth/v1/user", "/auth/v1/user"]);
});

it.each(entries)("$name independently rejects missing identity, foreign origins and Bearer requests", async ({ post, command }) => {
  const paths = login(), bytes = new TextEncoder().encode(JSON.stringify(command));
  const foreign = request(bytes); foreign.headers.set("origin", "https://outside.example");
  expect((await post(foreign)).status).toBe(403);
  const bearer = request(bytes); bearer.headers.set("authorization", "Bearer not-a-cookie-session");
  expect((await post(bearer)).status).toBe(403);
  expect(paths).toEqual([]);
  cookieFixture.values = [];
  const anonymous = await post(request(bytes));
  expect(anonymous.status).toBe(401); expect(await anonymous.json()).toEqual({ ok: false, code: "unauthenticated" });
  expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  expect(paths).toEqual([]);
});
