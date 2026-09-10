import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const cookieFixture = vi.hoisted(() => ({ values: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieFixture.values, set: () => {} }) }));
const accountId = "10000000-0000-4000-8000-000000000001";
const command = { accountId, turnId: accountId, sessionId: accountId, expectedRevision: 1, message: "想学摄影" };
const request = (body: unknown = command, headers: Record<string, string> = {}) => new Request("https://blueprint.example/api/clarification/turns", {
  method: "POST", headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
afterEach(() => { cookieFixture.values = []; vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function config() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://clarification.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-fixture");
  vi.stubEnv("BLUEPRINT_CLARIFICATION_ENABLED", "false");
}
function login() {
  const user = { id: accountId, role: "authenticated", is_anonymous: false };
  cookieFixture.values = [{ name: "sb-clarification-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: "local-fixture-token", refresh_token: "local-fixture-refresh", expires_at: Date.now() / 1000 + 600, user,
  })).toString("base64url")}` }];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    if (new URL(String(url)).pathname !== "/auth/v1/user") throw new Error("Unexpected external request");
    return Response.json(user);
  });
}
it("requires same-origin Cookie identity and an independent explicit opt-in before clarification", async () => {
  config();
  expect((await POST(request(command, { Origin: "https://other.example" }))).status).toBe(403);
  expect((await POST(request(command, { Authorization: "Bearer fixture" }))).status).toBe(403);
  expect((await POST(request())).status).toBe(401);
  login();
  const response = await POST(request());
  expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: false, code: "disabled" });
});
it("rejects mismatched identity and unbounded commands before any model or worker request", async () => {
  config(); login();
  expect((await POST(request({ ...command, accountId: "10000000-0000-4000-8000-000000000002" }))).status).toBe(403);
  for (const body of [{ ...command, ownerId: accountId }, { ...command, expectedRevision: 0 },
    { ...command, message: " " }, { ...command, message: "中".repeat(8001) }]) {
    const response = await POST(request(body));
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
  }
  const maximumValid = await POST(request({ ...command, message: "中".repeat(8000) }));
  expect(await maximumValid.json()).toEqual({ ok: false, code: "disabled" });
  const oversized = await POST(request({ ...command, message: "中".repeat(30000) }));
  expect(oversized.status).toBe(413);
});
it("bounds stalled uploads even when cancelling the request stream never resolves", async () => {
  config(); login(); vi.useFakeTimers();
  const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
    headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" } };
  const pending = POST(new Request("https://blueprint.example/api/clarification/turns", init));
  await vi.advanceTimersByTimeAsync(5001);
  const response = await pending;
  expect(response.status).toBe(408); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
});
it("rejects malformed UTF-8 instead of changing the user's answer to replacement characters", async () => {
  config(); login();
  const invalidUtf8 = Uint8Array.from([...new TextEncoder().encode(JSON.stringify(command).slice(0, -2)), 0xff, 34, 125]);
  const response = await POST(new Request("https://blueprint.example/api/clarification/turns", { method: "POST", body: invalidUtf8,
    headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" } }));
  expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: "invalid" });
});
it.each([[429, 503, "unavailable"], [503, 503, "unavailable"], [400, 401, "unauthenticated"]] as const)(
  "keeps a recoverable Auth refresh outage distinct from rejected identity (%s)", async (status, expectedStatus, code) => {
    config();
    vi.stubEnv("BLUEPRINT_CLARIFICATION_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "local-model-fixture");
    vi.stubEnv("BLUEPRINT_CLARIFICATION_WORKER_SECRET", "local-only-independent-worker-fixture-32");
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const user = { id: accountId, role: "authenticated", is_anonymous: false };
    cookieFixture.values = [{ name: "sb-clarification-auth-token", value: `base64-${Buffer.from(JSON.stringify({
      access_token: "local-fixture-token", refresh_token: "local-fixture-refresh", expires_at: now / 1000 + 600, user,
    })).toString("base64url")}` }];
    const verified = Promise.withResolvers<void>(), paths: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === "/auth/v1/user") { verified.resolve(); return Response.json(user); }
      if (path === "/auth/v1/token") { now += 31_000; return Response.json({ message: "Local Auth fixture" }, { status }); }
      throw new Error("Unexpected external request");
    });
    const body = new ReadableStream({ async start(controller) {
      await verified.promise; now += 700_000;
      controller.enqueue(new TextEncoder().encode(JSON.stringify(command))); controller.close();
    } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half",
      headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" } };
    const response = await POST(new Request("https://blueprint.example/api/clarification/turns", init));
    expect(response.status).toBe(expectedStatus); expect(await response.json()).toEqual({ ok: false, code });
    expect(paths).toEqual(["/auth/v1/user", "/auth/v1/token"]);
  });
