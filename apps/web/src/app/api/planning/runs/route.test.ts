import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
const cookieFixture = vi.hoisted(() => ({ values: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieFixture.values, set: () => {} }) }));
afterEach(() => { cookieFixture.values = []; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([[429, 503, "unavailable"], [503, 503, "unavailable"], [400, 401, "unauthenticated"]] as const)("classifies an actual SDK refresh failure %s after initial identity verification", async (status, expectedStatus, code) => {
  const accountId = "10000000-0000-4000-8000-000000000001";
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const user = { id: accountId, role: "authenticated", is_anonymous: false };
  cookieFixture.values = [{ name: "sb-planning-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token", expires_at: now / 1000 + 600, user,
  })).toString("base64url")}` }];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://planning.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "model-test");
  vi.stubEnv("BLUEPRINT_PLANNING_WORKER_SECRET", "independent-worker-fixture-32-characters");
  let verified!: () => void;
  const initiallyVerified = new Promise<void>(resolve => { verified = resolve; });
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname === "/auth/v1/user") { verified(); return Response.json(user); }
    if (url.pathname === "/auth/v1/token") {
      now += 31_000; // Advance the external clock past the SDK retry window, without sleeping.
      return Response.json({ message: "Temporary Auth fixture failure" }, { status });
    }
    throw new Error("Unexpected external request");
  });
  const body = new ReadableStream({ async start(controller) {
    await initiallyVerified; now += 700_000; // The body finishes after the captured access token expires.
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ accountId, runId: accountId, briefId: accountId,
      expectedBriefRevision: 1, expectedBlueprintVersion: 0, startDate: "2026-09-10" }))); controller.close();
  } });
  const init: RequestInit & { duplex: "half" } = { method: "POST",
    headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" }, body, duplex: "half" };
  const request = new Request("https://blueprint.example/api/planning/runs", init);
  const response = await POST(request);
  expect(paths).toEqual(["/auth/v1/user", "/auth/v1/token"]);
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ ok: false, code });
});
it("rejects cross-origin requests before authentication or provider setup", async () => {
  const response = await POST(new Request("https://blueprint.example/api/planning/runs", {
    method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: "{}",
  }));
  expect(response.status).toBe(403); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("requires an actual Cookie session before configuration or planning", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://planning.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture");
  const response = await POST(new Request("https://blueprint.example/api/planning/runs", {
    method: "POST", headers: { Host: "blueprint.example", Origin: "https://blueprint.example", "Content-Type": "application/json" }, body: "{}",
  }));
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
});
it("uses the browser-facing Host when Next supplies its internal request hostname", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://planning.example.test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture");
  const response = await POST(new Request("http://localhost:3100/api/planning/runs", { method: "POST",
    headers: { Host: "127.0.0.1:3100", Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" }, body: "{}" }));
  expect(response.status).toBe(401);
});
