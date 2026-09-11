import { afterEach, expect, it, vi } from "vitest";
import { explanationConfiguration, createRemoteExplanationWorker } from "./explanation-runtime";

afterEach(() => vi.unstubAllEnvs());
function environment() {
  vi.stubEnv("BLUEPRINT_EXPLANATION_ENABLED", "true");
  vi.stubEnv("BLUEPRINT_EXPLANATION_WORKER_SECRET", "explanation-only-fixture-worker-credential");
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-model-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
}
it("requires a separate explicit explanation opt-in without administrator credentials", () => {
  environment(); vi.stubEnv("BLUEPRINT_EXPLANATION_ENABLED", "false"); vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "true");
  expect(explanationConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_EXPLANATION_ENABLED", "true");
  expect(explanationConfiguration()).toEqual({ url: "http://127.0.0.1:54321", publishableKey: "fixture-public-key",
    apiKey: "fixture-model-key", workerKey: "explanation-only-fixture-worker-credential" });
});
it.each(["BLUEPRINT_EXPLANATION_WORKER_SECRET", "DEEPSEEK_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])("fails closed without %s", key => {
  environment(); vi.stubEnv(key, ""); expect(explanationConfiguration()).toBeNull();
});
it.each(["BLUEPRINT_PLANNING_WORKER_SECRET", "BLUEPRINT_CLARIFICATION_WORKER_SECRET", "BLUEPRINT_RESOURCE_WORKER_SECRET",
  "BLUEPRINT_TRANSLATION_WORKER_SECRET", "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "SUPADATA_API_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"])("rejects credential reuse with %s", key => {
  environment(); vi.stubEnv(key, "explanation-only-fixture-worker-credential"); expect(explanationConfiguration()).toBeNull();
});
it("routes only to its own worker with bounded nonredirecting transport and sanitized failures", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const worker = createRemoteExplanationWorker({ url: "https://cloud.example.test", publishableKey: "public-fixture", workerKey: "server-fixture" },
    "signed-fixture", "30000000-0000-4000-8000-000000000003", async (input, init) => {
      requests.push({ url: String(input), init }); return new Response("upstream private diagnostic", { status: 503 });
    });
  expect(await worker.claim({ runId: "10000000-0000-4000-8000-000000000001", leaseId: "20000000-0000-4000-8000-000000000002",
    skill: { name: "blueprint-explain-selection", version: "1.0.0", instructions: "fixture", sha256: "a".repeat(64) }, model: "fixture-model" }))
    .toEqual({ ok: false, code: "unavailable" });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe("https://cloud.example.test/functions/v1/explanation-worker");
  expect(requests[0]?.init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    headers: { apikey: "public-fixture", Authorization: "Bearer signed-fixture", "x-blueprint-worker-secret": "server-fixture" } });
  const sent = JSON.parse(String(requests[0]?.init?.body));
  expect(sent.operation).toBe("claim"); expect(sent).not.toHaveProperty("ownerId");
});
