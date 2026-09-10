import { afterEach, expect, test, vi } from "vitest";
import { resourceAdoptionConfiguration, createResourceAdoptionWorker } from "./resource-adoption-runtime";
afterEach(() => vi.unstubAllEnvs());
function env() {
  vi.stubEnv("BLUEPRINT_RESOURCE_ADOPTION_ENABLED", "true"); vi.stubEnv("BLUEPRINT_RESOURCE_WORKER_SECRET", "resource-only-secret-at-least-thirty-two-characters");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public");
  vi.stubEnv("YOUTUBE_API_KEY", "fixture-youtube"); vi.stubEnv("DEEPSEEK_API_KEY", ""); vi.stubEnv("SUPADATA_API_KEY", "");
}
test("verification has its own opt-in and needs no model or transcript keys", async () => {
  env(); vi.stubEnv("BLUEPRINT_RESOURCE_ADOPTION_ENABLED", "false"); expect(resourceAdoptionConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_RESOURCE_ADOPTION_ENABLED", "true");
  const config = resourceAdoptionConfiguration(); expect(config?.youtubeApiKey).toBe("fixture-youtube");
  if (!config) throw new Error("Missing configuration");
  const envelopes: unknown[] = [];
  const worker = createResourceAdoptionWorker(config, "user-token", async (url, options) => {
    expect(String(url)).toBe("http://127.0.0.1:54321/functions/v1/resource-worker");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer user-token");
    const body = String(options?.body); expect(body).not.toMatch(/fixture-youtube|ownerId/); envelopes.push(JSON.parse(body));
    return Response.json({ data: {}, error: null });
  });
  await worker.claim({ adoptionId: "adoption", leaseId: "lease" });
  await worker.finish({ adoptionId: "adoption", leaseId: "lease", result: { status: "changed" } });
  expect(envelopes).toEqual([{ operation: "adoption_claim", adoptionId: "adoption", leaseId: "lease" }, { operation: "adoption_finish", adoptionId: "adoption", leaseId: "lease", result: { status: "changed" } }]);
});
test.each(["", "short", "sb_secret_not_an_independent_secret", "this-is-a-long-header.payload.signature"])("unsafe verification credentials remain disabled %#", key => {
  env(); vi.stubEnv("BLUEPRINT_RESOURCE_WORKER_SECRET", key); expect(resourceAdoptionConfiguration()).toBeNull();
});
test.each(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "YOUTUBE_API_KEY", "DEEPSEEK_API_KEY", "SUPADATA_API_KEY", "BLUEPRINT_PLANNING_WORKER_SECRET", "BLUEPRINT_CLARIFICATION_WORKER_SECRET"])("verification does not reuse %s as worker authority", key => {
  env(); vi.stubEnv(key, "resource-only-secret-at-least-thirty-two-characters"); expect(resourceAdoptionConfiguration()).toBeNull();
});
