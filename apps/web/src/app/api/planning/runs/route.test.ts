import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
afterEach(() => vi.unstubAllEnvs());
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
