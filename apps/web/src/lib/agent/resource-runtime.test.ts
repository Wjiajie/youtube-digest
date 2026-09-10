import { afterEach, expect, it, vi } from "vitest";
import { resourceConfiguration, createResourceWorker } from "./resource-runtime";

afterEach(() => vi.unstubAllEnvs());
function environment() {
  vi.stubEnv("BLUEPRINT_RESOURCES_ENABLED", "true");
  vi.stubEnv("BLUEPRINT_RESOURCE_WORKER_SECRET", "resource-only-worker-test-secret-32-characters");
  vi.stubEnv("BLUEPRINT_PLANNING_WORKER_SECRET", "planning-only-worker-test-secret-32-characters");
  vi.stubEnv("BLUEPRINT_CLARIFICATION_WORKER_SECRET", "clarification-only-worker-test-secret-32-characters");
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-model-key");
  vi.stubEnv("YOUTUBE_API_KEY", "fixture-youtube-key");
  vi.stubEnv("SUPADATA_API_KEY", "fixture-native-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
}
it("keeps resource execution disabled despite configured provider keys or other enabled stages", () => {
  environment(); vi.stubEnv("BLUEPRINT_RESOURCES_ENABLED", "false"); vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("BLUEPRINT_CLARIFICATION_ENABLED", "true");
  expect(resourceConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_RESOURCES_ENABLED", "true");
  expect(resourceConfiguration()).toEqual({ url: "http://127.0.0.1:54321", publishableKey: "fixture-public-key", apiKey: "fixture-model-key",
    workerKey: "resource-only-worker-test-secret-32-characters", youtubeApiKey: "fixture-youtube-key", supadataApiKey: "fixture-native-key" });
});

it.each(["BLUEPRINT_RESOURCE_WORKER_SECRET", "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "SUPADATA_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])("fails closed when %s is missing", name => {
  environment(); vi.stubEnv(name, ""); expect(resourceConfiguration()).toBeNull();
});
it.each(["short", "sb_secret_not_a_separate_worker_credential", "header.payload.signature_that_is_long_enough"])("rejects unsuitable worker secrets", secret => {
  environment(); vi.stubEnv("BLUEPRINT_RESOURCE_WORKER_SECRET", secret); expect(resourceConfiguration()).toBeNull();
});
it.each(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "SUPADATA_API_KEY", "BLUEPRINT_PLANNING_WORKER_SECRET", "BLUEPRINT_CLARIFICATION_WORKER_SECRET"])("does not reuse %s as the resource worker secret", key => {
  environment(); vi.stubEnv(key, "resource-only-worker-test-secret-32-characters"); expect(resourceConfiguration()).toBeNull();
});
it("sends the exact narrow claim and finish envelopes to the fixed worker, without provider or administrator keys", async () => {
  environment(); const config = resourceConfiguration(); if (!config) throw new Error("Missing fixture configuration");
  const envelopes: unknown[] = [];
  const worker = createResourceWorker(config, "fixture-user-token", async (input, options) => {
    expect(String(input)).toBe("http://127.0.0.1:54321/functions/v1/resource-worker");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer fixture-user-token");
    expect(headers.get("apikey")).toBe("fixture-public-key");
    expect(headers.get("x-blueprint-worker-secret")).toBe(config.workerKey);
    expect(options?.redirect).toBe("error"); expect(options?.cache).toBe("no-store");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const body = String(options?.body); expect(body).not.toMatch(/fixture-model-key|fixture-native-key|fixture-youtube-key|ownerId/);
    envelopes.push(JSON.parse(body)); return Response.json({ data: { receipt: true }, error: null });
  });
  await worker.claim({ runId: "run", leaseId: "lease", skill: null });
  await worker.finish({ runId: "run", leaseId: "lease", result: { status: "cancelled" } });
  expect(envelopes).toEqual([{ operation: "claim", runId: "run", leaseId: "lease", skill: null }, { operation: "finish", runId: "run", leaseId: "lease", result: { status: "cancelled" } }]);
});
it.each(["invalid_json", "untrusted_envelope", "redirect", "throw"])("sanitizes %s transport failure without retry", async mode => {
  environment(); const config = resourceConfiguration(); if (!config) throw new Error("Missing configuration");
  let calls = 0;
  const worker = createResourceWorker(config, "fixture-token", async () => {
    calls++;
    if (mode === "throw") throw new Error("PRIVATE_TRANSPORT_BODY");
    if (mode === "invalid_json") return new Response("PRIVATE_TRANSPORT_BODY");
    if (mode === "redirect") return new Response(null, { status: 302 });
    return Response.json({ data: {}, error: null, privateBody: "PRIVATE_TRANSPORT_BODY" });
  });
  expect(await worker.claim({ runId: "run", leaseId: "lease", skill: null })).toEqual({ data: null, error: { code: "unavailable", message: "unavailable" } });
  expect(calls).toBe(1);
});
