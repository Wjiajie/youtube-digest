import { afterEach, expect, it, vi } from "vitest";
import { planningConfiguration, createPlanningModel, createPlanningWorker } from "./planning-runtime";
import { generateText, Output } from "ai";
import { z } from "zod";
afterEach(() => vi.unstubAllEnvs());
it("uses the narrow Edge worker with both credentials and never sends an owner or admin key", async () => {
  const worker = createPlanningWorker({ url: "http://127.0.0.1:54321", publishableKey: "public-test-key",
    apiKey: "model-test-key", workerKey: "independent-worker-test-secret-32-characters" }, "user-token", async (url, init) => {
    expect(String(url)).toBe("http://127.0.0.1:54321/functions/v1/planning-worker");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer user-token");
    expect(headers.get("x-blueprint-worker-secret")).toBe("independent-worker-test-secret-32-characters");
    expect(JSON.parse(String(init?.body))).toEqual({ operation: "claim", runId: "run", leaseId: "lease", skill: {} });
    return Response.json({ data: { acquired: false }, error: null });
  });
  expect(await worker.claim({ runId: "run", leaseId: "lease", skill: {} })).toEqual({ data: { acquired: false }, error: null });
});
it("requires explicit activation and all server credentials", () => {
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "false");
  expect(planningConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "");
  expect(planningConfiguration()).toBeNull();
});
it("does not activate with the retired administrator-key configuration", () => {
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "fixture");
  vi.stubEnv("SUPABASE_PLANNING_SECRET_KEY", "retired-admin-key"); vi.stubEnv("BLUEPRINT_PLANNING_WORKER_SECRET", "");
  expect(planningConfiguration()).toBeNull();
});
it.each(["sb_secret_this_is_not_an_independent_worker_secret", "header.payload.signature_that_is_long_enough"])("rejects API-key-shaped worker configuration", workerKey => {
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "fixture");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  vi.stubEnv("BLUEPRINT_PLANNING_WORKER_SECRET", workerKey);
  expect(planningConfiguration()).toBeNull();
});
it("uses the real DeepSeek SDK with the fixed model and parses structured output", async () => {
  const requests: unknown[] = [];
  const model = createPlanningModel("fixture-key", async (input, init) => {
    expect(String(input)).toBe("https://api.deepseek.com/chat/completions");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "fixture", object: "chat.completion", created: 1, model: "deepseek-v4-flash",
      choices: [{ index: 0, message: { role: "assistant", content: '{"title":"练习摄影"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  });
  const result = await generateText({ model, prompt: "Return JSON", maxRetries: 0, output: Output.object({ schema: z.object({ title: z.string() }) }) });
  expect(result.output).toEqual({ title: "练习摄影" });
  expect(requests).toMatchObject([{ model: "deepseek-flash" }]);
});
