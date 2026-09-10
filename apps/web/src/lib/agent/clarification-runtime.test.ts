import { afterEach, expect, it, vi } from "vitest";
import { clarificationConfiguration, createClarificationWorker } from "./clarification-runtime";
afterEach(() => vi.unstubAllEnvs());

it("sends only a fixed clarification operation and both credentials to Edge", async () => {
  const worker = createClarificationWorker({ url: "http://127.0.0.1:54321", publishableKey: "public-fixture",
    apiKey: "model-fixture", workerKey: "independent-clarification-secret-for-fixture" }, "user-token", async (url, options) => {
    expect(String(url)).toBe("http://127.0.0.1:54321/functions/v1/clarification-worker");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer user-token");
    expect(new Headers(options?.headers).get("x-blueprint-worker-secret")).toBe("independent-clarification-secret-for-fixture");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(String(options?.body))).toEqual({ operation: "claim", turnId: "turn", leaseId: "lease", skill: {} });
    return Response.json({ data: { acquired: false }, error: null });
  });
  expect(await worker.claim({ turnId: "turn", leaseId: "lease", skill: {} })).toEqual({ data: { acquired: false }, error: null });
});

it("requires a separate explicit enable flag and independent clarification credential", () => {
  vi.stubEnv("BLUEPRINT_CLARIFICATION_ENABLED", "false"); vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true");
  vi.stubEnv("DEEPSEEK_API_KEY", "model-fixture"); vi.stubEnv("BLUEPRINT_PLANNING_WORKER_SECRET", "planning-is-not-clarification-secret");
  expect(clarificationConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_CLARIFICATION_ENABLED", "true"); vi.stubEnv("BLUEPRINT_CLARIFICATION_WORKER_SECRET", "");
  expect(clarificationConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_CLARIFICATION_WORKER_SECRET", "sb_secret_not_an_independent_secret");
  expect(clarificationConfiguration()).toBeNull();
});
