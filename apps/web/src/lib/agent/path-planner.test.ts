import { describe, expect, it, vi } from "vitest";
import { APICallError, registerTelemetry } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { blueprintSnapshotSchema, goalBriefSchema } from "@blueprint/domain";
import { createPathPlanner } from "./path-planner";

const blueprintId = "10000000-0000-4000-8000-000000000001";
const input = () => ({
  runId: "10000000-0000-4000-8000-000000000002",
  startDate: "2026-09-10",
  signal: new AbortController().signal,
  brief: goalBriefSchema.parse({ id: "10000000-0000-4000-8000-000000000003", blueprintId, revision: 2,
    status: "confirmed", updatedAt: "2026-09-10T00:00:00Z",
    content: { schemaVersion: 1, outcome: "完成可分享的摄影作品集", startingPoint: "会使用相机自动档", targetDate: "2026-11-10",
      weeklyMinutes: 180, constraints: "只有周末有空", successCriteria: "完成六张作品并得到具体反馈" } }),
  blueprint: blueprintSnapshotSchema.parse({ schemaVersion: 2, id: blueprintId, version: 4, title: "我的蓝图", goals: [] }),
});

function plan() {
  return { title: "摄影作品集", description: "以拍摄和反馈形成作品集", assumptions: ["周末可集中练习"], stages: [
    { title: "建立曝光与取景基础", nodes: [
      { key: "learn", type: "learn", title: "比较曝光组合", description: "观察快门和光圈对画面的影响", estimatedMinutes: 30,
        completionCriteria: "记录三组曝光差异", week: 1, dependsOn: [] },
      { key: "practice", type: "practice", title: "拍摄同一主题", description: "用不同曝光拍摄并挑选作品", estimatedMinutes: 60,
        completionCriteria: "挑选六张并说明取舍", week: 1, dependsOn: ["learn"] },
      { key: "review", type: "checkpoint", title: "检查作品", description: "对照标准寻求具体反馈", estimatedMinutes: 30,
        completionCriteria: "记录两项改进及相应样片", week: 2, dependsOn: ["practice"] },
    ] },
  ] };
}

function reply(text: string): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: undefined } }, warnings: [] };
}

describe("controlled path planning", () => {
  it.each(["mismatched blueprint", "past deadline", "full blueprint", "invalid date"])("rejects %s before provider work", async problem => {
    const request = input();
    if (problem === "mismatched blueprint") request.brief.blueprintId = "20000000-0000-4000-8000-000000000001";
    if (problem === "past deadline") request.brief.content.targetDate = "2026-09-09";
    if (problem === "invalid date") request.startDate = "0000-01-01";
    if (problem === "full blueprint") request.blueprint.goals = Array.from({ length: 12 }, (_, position) => ({
      id: `20000000-0000-4000-8000-${String(position).padStart(12, "0")}`, title: "Existing goal", position, stages: [],
    }));
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(plan())) });
    expect(await createPathPlanner({ model }).run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("does not start an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    const model = new MockLanguageModelV4();
    expect(await createPathPlanner({ model }).run({ ...input(), signal: controller.signal })).toEqual({ status: "cancelled", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("requires an actually confirmed input definition before contacting a provider", async () => {
    const model = new MockLanguageModelV4();
    const request = input(); request.brief.status = "draft";
    expect(await createPathPlanner({ model }).run(request)).toEqual({ status: "needs_confirmation", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("runs the real SDK parser and returns a reviewable isolated draft with application-owned IDs", async () => {
    const request = input();
    request.blueprint.goals.push({ id: "20000000-0000-4000-8000-000000000001", title: "OTHER_GOAL_PRIVATE", position: 7, stages: [] });
    const original = structuredClone({ brief: request.brief, blueprint: request.blueprint });
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(plan())) });
    const result = await createPathPlanner({ model }).run(request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected ready candidate");
    expect(result.draft.goals[0]).toEqual(original.blueprint.goals[0]);
    const goal = result.draft.goals[1];
    expect(goal.position).toBe(8);
    expect(goal.stages[0].nodes.map(node => node.resources)).toEqual([[], [], []]);
    expect(goal.stages[0].nodes[1].dependencyIds).toEqual([goal.stages[0].nodes[0].id]);
    expect(result.schedule.map(item => item.week)).toEqual([1, 1, 2]);
    expect(result.source).toEqual({ runId: request.runId, briefId: request.brief.id, briefRevision: 2, blueprintId, blueprintVersion: 4, startDate: request.startDate });
    expect(result.skill).toMatchObject({ name: "blueprint-plan-path", version: "1.0.0", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 40, totalTokens: 60 });
    expect(request.brief).toEqual(original.brief); expect(request.blueprint).toEqual(original.blueprint);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toContain("OTHER_GOAL_PRIVATE");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("只有周末有空");
    expect(model.doGenerateCalls[0].tools ?? []).toEqual([]);
  });

  it.each([
    ["duplicate key", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[1].key = "learn"; }],
    ["unknown dependency", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[1].dependsOn = ["missing"]; }],
    ["self dependency", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[0].dependsOn = ["learn"]; }],
    ["forward dependency", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[0].dependsOn = ["review"]; }],
    ["duplicate dependency", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[1].dependsOn = ["learn", "learn"]; }],
    ["dependency scheduled later", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[0].week = 2; }],
    ["weekly overspend", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[1].estimatedMinutes = 151; }],
    ["past deadline", (value: ReturnType<typeof plan>) => { value.stages[0].nodes[2].week = 26; }],
  ])("rejects %s without leaking generated content", async (_label, mutate) => {
    const candidate = plan(); mutate(candidate);
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(candidate)) });
    expect(await createPathPlanner({ model }).run(input())).toEqual({ status: "invalid_output", providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it.each(["PRIVATE_INVALID_JSON", JSON.stringify({ ...plan(), resources: ["https://unverified.invalid/private"] }),
    JSON.stringify({ ...plan(), stages: [] })])("handles malformed or forbidden output safely", async text => {
    const model = new MockLanguageModelV4({ doGenerate: reply(text) });
    expect(await createPathPlanner({ model }).run(input())).toEqual({ status: "invalid_output", providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
  });

  it("rejects incomplete provider output even when it happens to contain valid JSON", async () => {
    const response = reply(JSON.stringify(plan())); response.finishReason.unified = "length";
    const model = new MockLanguageModelV4({ doGenerate: response });
    expect(await createPathPlanner({ model }).run(input())).toEqual({ status: "invalid_output", providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
  });

  it("does not retry a retryable provider failure or expose its private payload", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      throw new APICallError({ message: "PRIVATE_PROVIDER_ERROR", url: "https://provider.invalid/private",
        requestBodyValues: { prompt: "PRIVATE_PROMPT" }, statusCode: 503, responseBody: "PRIVATE_RESPONSE", isRetryable: true });
    } });
    expect(await createPathPlanner({ model }).run(input())).toEqual({ status: "unavailable", providerMayHaveRun: true, usage: null });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("does not send provider warning text into the SDK's ordinary warning logger", async () => {
    const logged = vi.fn();
    const previousLogger = globalThis.AI_SDK_LOG_WARNINGS;
    globalThis.AI_SDK_LOG_WARNINGS = logged;
    const response = reply(JSON.stringify(plan())); response.warnings = [{ type: "other", message: "PRIVATE_WARNING_TEXT" }];
    try {
      const model = new MockLanguageModelV4({ doGenerate: response });
      expect((await createPathPlanner({ model }).run(input())).status).toBe("ready");
      expect(logged).not.toHaveBeenCalled();
    } finally {
      globalThis.AI_SDK_LOG_WARNINGS = previousLogger;
    }
  });

  it("keeps unreported token counts unknown", async () => {
    const response = reply(JSON.stringify(plan()));
    response.usage.inputTokens.total = undefined; response.usage.outputTokens.total = undefined;
    const model = new MockLanguageModelV4({ doGenerate: response });
    const result = await createPathPlanner({ model }).run(input());
    expect(result.status).toBe("ready");
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("opts out of global SDK telemetry that could record raw goals and completions", async () => {
    const recorded = vi.fn();
    const previous = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
    globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = [];
    registerTelemetry({ onStart: recorded, onEnd: recorded, onLanguageModelCallStart: recorded, onLanguageModelCallEnd: recorded });
    try {
      const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(plan())) });
      expect((await createPathPlanner({ model }).run(input())).status).toBe("ready");
      expect(recorded).not.toHaveBeenCalled();
    } finally {
      globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = previous;
    }
  });

  it("cancels promptly even if the provider ignores abort, and discards a late response", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const deferred = Promise.withResolvers<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>>();
    const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return deferred.promise; } });
    const running = createPathPlanner({ model }).run({ ...input(), signal: controller.signal });
    await started.promise; controller.abort();
    try {
      expect(await running).toEqual({ status: "cancelled", providerMayHaveRun: true, usage: null });
    } finally {
      deferred.resolve(reply(JSON.stringify(plan())));
    }
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("bounds a stalled generation to 60 seconds, even if provider abort is ignored", async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const deferred = Promise.withResolvers<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>>();
    const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return deferred.promise; } });
    try {
      const running = createPathPlanner({ model }).run(input());
      await started.promise;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await running).toEqual({ status: "timed_out", providerMayHaveRun: true, usage: null });
      expect(model.doGenerateCalls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      deferred.resolve(reply(JSON.stringify(plan())));
      vi.useRealTimers();
    }
  });

  it("preserves the captured input revisions when caller objects change during generation", async () => {
    const request = input();
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      request.brief.revision = 3; request.brief.status = "draft";
      request.blueprint.version = 5; request.blueprint.title = "Later title";
      return reply(JSON.stringify(plan()));
    } });
    const result = await createPathPlanner({ model }).run(request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected draft for captured inputs");
    expect(result.source).toMatchObject({ briefRevision: 2, blueprintVersion: 4 });
    expect(result.draft.title).toBe("我的蓝图");
    expect(result.draft.version).toBe(4);
  });

  it("accepts an exact weekly budget and inclusive deadline without assuming daily availability", async () => {
    const request = input(); request.brief.content.weeklyMinutes = 90; request.brief.content.targetDate = "2026-09-17";
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(plan())) });
    expect((await createPathPlanner({ model }).run(request)).status).toBe("ready");
  });

  it("accepts an unknown deadline and does not force all four node types into a plan", async () => {
    const request = input(); request.brief.content.targetDate = null;
    const candidate = plan(); candidate.stages[0].nodes = [candidate.stages[0].nodes[1]];
    candidate.stages[0].nodes[0].dependsOn = []; candidate.stages[0].nodes[0].week = 26;
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(candidate)) });
    expect((await createPathPlanner({ model }).run(request)).status).toBe("ready");
  });

  it("counts the weekly budget across stages, not just inside each stage", async () => {
    const candidate = plan();
    candidate.stages.push({ title: "另一个阶段", nodes: [{ ...candidate.stages[0].nodes[0], key: "extra", estimatedMinutes: 91 }] });
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(candidate)) });
    expect((await createPathPlanner({ model }).run(input())).status).toBe("invalid_output");
  });

  it("caps candidate size independently of each stage's size", async () => {
    const request = input(); request.brief.content.weeklyMinutes = 10080;
    const candidate = plan();
    candidate.stages = Array.from({ length: 5 }, (_, stage) => ({ title: `Stage ${stage}`, nodes: Array.from({ length: 26 }, (_, node) => ({
      ...plan().stages[0].nodes[0], key: `node_${stage}_${node}`,
    })) }));
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(candidate)) });
    expect((await createPathPlanner({ model }).run(request)).status).toBe("invalid_output");
  });

  it("rejects resource bindings supplied by the model inside a node", async () => {
    const candidate = plan();
    const text = JSON.stringify(candidate, (key, value) => key === "nodes" ? value.map((node: object) => ({
      ...node, resources: [{ provider: "youtube", externalId: "unverified" }],
    })) : value);
    const model = new MockLanguageModelV4({ doGenerate: reply(text) });
    expect((await createPathPlanner({ model }).run(input())).status).toBe("invalid_output");
  });

  it("does not hand back an invalid draft if application ID generation fails", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(JSON.stringify(plan())) });
    expect(await createPathPlanner({ model, newId: () => blueprintId }).run(input())).toEqual({ status: "unavailable", providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
  });
});
