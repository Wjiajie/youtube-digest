import { afterEach, expect, it, vi } from "vitest";
import { planningConfiguration, createPlanningModel } from "./planning-runtime";
import { generateText, Output } from "ai";
import { z } from "zod";
afterEach(() => vi.unstubAllEnvs());
it("requires explicit activation and all server credentials", () => {
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "false");
  expect(planningConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_PLANNING_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "");
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
  expect(requests).toMatchObject([{ model: "deepseek-v4-flash" }]);
});
