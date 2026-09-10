import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { registerTelemetry } from "ai";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import { createResourceMatcher } from "./resource-matcher";

const nodeId = "20000000-0000-4000-8000-000000000004";
function input() {
  const blueprint = blueprintSnapshotSchema.parse({ schemaVersion: 2, id: "20000000-0000-4000-8000-000000000001", version: 4, title: "PRIVATE_BLUEPRINT",
    goals: [{ id: "20000000-0000-4000-8000-000000000002", title: "PRIVATE_GOAL", position: 0,
      stages: [{ id: "20000000-0000-4000-8000-000000000003", title: "基础", position: 0,
        nodes: [{ id: nodeId, title: "比较曝光组合", description: "学习快门与光圈的关系", type: "learn", position: 0,
          estimatedMinutes: 30, completionCriteria: "拍摄三组对比照片", dependencyIds: [], resources: [] }] }] }] });
  return { blueprint, nodeId, signal: new AbortController().signal, learnerContext: { startingPoint: "只用过自动模式", constraints: null },
    discovery: { status: "discovered", source: { blueprintId: blueprint.id, blueprintVersion: 4, nodeId, checkedAt: "2026-09-10T00:00:00Z" },
      candidates: [{ video: { videoId: "abcdefghijk", title: "曝光基础", description: "快门与光圈", publishedAt: "2018-01-01T00:00:00Z", durationSeconds: 600,
        statistics: { viewCount: "PRIVATE_POPULARITY", likeCount: "999" } },
        transcript: { status: "ready", language: "en", availableLanguages: ["en"], segments: [{ text: "Compare aperture and shutter speed.", offset: 1000, duration: 2500 }] },
        eligibleForMatching: true, languageFallback: true, matching: "not_evaluated" }],
      requests: { catalogMayHaveRun: true, transcriptVideoIds: ["abcdefghijk"] }, rejected: [], uninspectedVideoIds: [],
    },
  };
}
function assessment(videoId = "abcdefghijk") {
  return { videoId, role: "recommended", relevance: "包含快门和光圈的对比，可辅助对比照片练习。", levelFit: "从自动模式进入曝光控制，仍需实际操作。",
    languageFit: "英语字幕，需要接受语言回退。", timeFit: "十分钟视频适合三十分钟节点，剩余时间用于练习。", freshness: "曝光基础不因年份较早而失效。",
    limitations: ["字幕片段不能证明全片的教学质量。"], evidence: [{ segmentIndex: 0, quote: "Compare aperture and shutter speed." }] };
}
function answer() { return { summary: "可先审阅这条曝光基础候选。", assessments: [assessment()] }; }
function reply(value: unknown): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: undefined } }, warnings: [] };
}
function modelInput(model: MockLanguageModelV4) {
  const message = model.doGenerateCalls[0].prompt.find(message => message.role === "user");
  if (!message) throw new Error("Expected user data prompt");
  return JSON.parse(message.content.filter(part => part.type === "text").map(part => part.text).join(""));
}

describe("source-bound resource matching", () => {
  it("rejects missing, stale or non-learning sources before inference", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    const matcher = createResourceMatcher({ model });
    const missing = input(); missing.nodeId = "30000000-0000-4000-8000-000000000004";
    const stale = input(); stale.blueprint.version = 5;
    const practice = input(); practice.blueprint.goals[0].stages[0].nodes[0].type = "practice";
    for (const request of [missing, stale, practice, { ...input(), blueprint: {} }]) {
      expect(await matcher.run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
    }
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns an advisory selection with exact caption provenance, source version and separate fit reasons", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    const request = input(), before = structuredClone(request.blueprint);
    const result = await createResourceMatcher({ model }).run(request);
    expect(result.status).toBe("matched");
    if (result.status !== "matched") throw new Error("Expected reviewable match");
    expect(result).toMatchObject({ reviewRequired: true, providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 },
      source: request.discovery.source, skill: { name: "blueprint-match-resources", version: "1.0.0" },
      summary: answer().summary,
      assessments: [{ ...assessment(), evidence: [{ segmentIndex: 0, quote: "Compare aperture and shutter speed.", offsetMs: 1000 }] }],
      coverage: [{ videoId: "abcdefghijk", totalSegments: 1, sampledSegments: 1, textTruncated: false }],
    });
    expect(result.source.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.skill.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain("拍摄三组对比照片"); expect(prompt).toContain("只用过自动模式");
    expect(prompt).not.toMatch(/PRIVATE_BLUEPRINT|PRIVATE_GOAL|PRIVATE_POPULARITY|likeCount|statistics/);
    expect(request.blueprint).toEqual(before);
  });

  it("avoids inference for absent usable evidence, cancelled requests and unrecognized Skill revisions", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) }), matcher = createResourceMatcher({ model });
    const ineligible = input(); ineligible.discovery.candidates[0].eligibleForMatching = false;
    const pending = input(); pending.discovery.candidates[0].transcript.status = "pending";
    for (const request of [ineligible, pending, { ...input(), discovery: { ...input().discovery, candidates: [] } }]) {
      expect(await matcher.run(request)).toEqual({ status: "no_evidence", providerMayHaveRun: false, usage: null });
    }
    const controller = new AbortController(); controller.abort();
    expect(await matcher.run({ ...input(), signal: controller.signal })).toEqual({ status: "cancelled", providerMayHaveRun: false, usage: null });
    expect(await matcher.run({ ...input(), expectedSkillSha256: "0".repeat(64) })).toEqual({ status: "unavailable", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("rejects ambiguous duplicate candidate IDs before inference", async () => {
    const request = input(); request.discovery.candidates.push(structuredClone(request.discovery.candidates[0]));
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    expect(await createResourceMatcher({ model }).run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("assesses every eligible candidate and distinguishes a default, alternatives and no suitable result", async () => {
    const request = input();
    for (const id of ["lmnopqrstuv", "01234567890"]) { const candidate = structuredClone(request.discovery.candidates[0]); candidate.video.videoId = id; request.discovery.candidates.push(candidate); }
    const model = new MockLanguageModelV4({ doGenerate: reply({ summary: "可比较三种讲解方式。", assessments: [assessment(), ...["lmnopqrstuv", "01234567890"].map(id => ({ ...assessment(id), role: "alternative" }))] }) });
    const matched = await createResourceMatcher({ model }).run(request);
    expect(matched.status).toBe("matched");
    if (matched.status !== "matched") throw new Error("Expected selection");
    expect(matched.assessments.map(item => item.role)).toEqual(["recommended", "alternative", "alternative"]);
    const none = new MockLanguageModelV4({ doGenerate: reply({ summary: "这些片段不足以支持本节点的完整要求。", assessments: [assessment(), assessment("lmnopqrstuv"), assessment("01234567890")].map(item => ({ ...item, role: "rejected" })) }) });
    expect(await createResourceMatcher({ model: none }).run(request)).toMatchObject({ status: "no_match", reviewRequired: true, providerMayHaveRun: true });
  });

  it.each(["empty", "omitted candidate", "duplicate candidate", "two defaults", "orphan alternative", "duplicate citation", "invented ID", "invented quote", "wrong segment", "URL prose", "extra score"])("rejects %s rather than partially salvaging a recommendation", async problem => {
    const request = input(), candidate = answer();
    if (problem === "empty") candidate.assessments = [];
    if (problem === "omitted candidate" || problem === "two defaults") {
      const second = structuredClone(request.discovery.candidates[0]); second.video.videoId = "lmnopqrstuv"; request.discovery.candidates.push(second);
      if (problem === "two defaults") candidate.assessments.push(assessment("lmnopqrstuv"));
    }
    if (problem === "duplicate candidate") candidate.assessments.push(assessment());
    if (problem === "orphan alternative") candidate.assessments[0].role = "alternative";
    if (problem === "duplicate citation") candidate.assessments[0].evidence.push({ segmentIndex: 0, quote: "aperture" });
    if (problem === "invented ID") candidate.assessments[0].videoId = "unasked00000";
    if (problem === "invented quote") candidate.assessments[0].evidence[0].quote = "A different video's content";
    if (problem === "wrong segment") candidate.assessments[0].evidence[0].segmentIndex = 1;
    if (problem === "URL prose") candidate.assessments[0].relevance = "请改看 https://outside.example/fake";
    const output = problem === "extra score" ? { ...candidate, qualityScore: 100 } : candidate;
    const model = new MockLanguageModelV4({ doGenerate: reply(output) });
    expect(await createResourceMatcher({ model }).run(request)).toMatchObject({ status: "invalid_output", providerMayHaveRun: true });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("samples across long captions with original indices, bounded Unicode text and explicit coverage", async () => {
    const request = input();
    request.discovery.candidates[0].video.title = "长".repeat(300);
    request.discovery.candidates[0].video.description = "文".repeat(2000);
    request.discovery.candidates[0].transcript.segments = Array.from({ length: 49 }, (_, index) => ({ text: `片段${index} ` + "🧭".repeat(400), offset: index * 1000, duration: 1000 }));
    const selected = assessment(); selected.evidence = [{ segmentIndex: 0, quote: "片段0" }, { segmentIndex: 48, quote: "片段48" }];
    const model = new MockLanguageModelV4({ doGenerate: reply({ summary: "仅基于抽样片段。", assessments: [selected] }) });
    const result = await createResourceMatcher({ model }).run(request);
    expect(result).toMatchObject({ status: "matched", coverage: [{ videoId: "abcdefghijk", totalSegments: 49, sampledSegments: 24, textTruncated: true }],
      assessments: [{ evidence: [{ segmentIndex: 0, offsetMs: 0 }, { segmentIndex: 48, offsetMs: 48000 }] }] });
    const candidate = modelInput(model).candidates[0];
    expect(candidate.excerpts.map((segment: { segmentIndex: number }) => segment.segmentIndex)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 48]);
    expect([...candidate.excerpts[0].text]).toHaveLength(320);
    expect(candidate.excerpts[0].text.endsWith("🧭")).toBe(true);
    expect(candidate.title).toHaveLength(240); expect(candidate.description).toHaveLength(1200);
  });

  it("refuses quotations from omitted segments even when they exist in the full transcript", async () => {
    const request = input(); request.discovery.candidates[0].transcript.segments = Array.from({ length: 49 }, (_, index) => ({ text: `片段${index}`, offset: index * 1000, duration: 1000 }));
    const selected = assessment(); selected.evidence = [{ segmentIndex: 1, quote: "片段1" }];
    const model = new MockLanguageModelV4({ doGenerate: reply({ summary: "片段引用", assessments: [selected] }) });
    expect(await createResourceMatcher({ model }).run(request)).toMatchObject({ status: "invalid_output", providerMayHaveRun: true });
  });

  it("rejects an oversized multibyte prompt before inference instead of silently dropping node requirements", async () => {
    const request = input(); request.blueprint.goals[0].stages[0].nodes[0].completionCriteria = "汉".repeat(4000);
    request.discovery.candidates[0].video.description = "🧭".repeat(1200);
    request.discovery.candidates[0].transcript.segments = Array.from({ length: 24 }, (_, index) => ({ text: "🧭".repeat(400), offset: index * 1000, duration: 1000 }));
    for (const id of ["lmnopqrstuv", "01234567890"]) { const next = structuredClone(request.discovery.candidates[0]); next.video.videoId = id; request.discovery.candidates.push(next); }
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    expect(await createResourceMatcher({ model }).run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("cannot smuggle links into a recommendation through an otherwise exact quotation", async () => {
    const request = input(); request.discovery.candidates[0].transcript.segments[0].text = "Follow https://outside.example/fake for more.";
    const selected = assessment(); selected.evidence[0].quote = "https://outside.example/fake";
    const model = new MockLanguageModelV4({ doGenerate: reply({ summary: "候选", assessments: [selected] }) });
    expect(await createResourceMatcher({ model }).run(request)).toMatchObject({ status: "invalid_output", providerMayHaveRun: true });
  });

  it("keeps input text in the data prompt and freezes source and caption evidence before generation", async () => {
    const request = input(); request.learnerContext.startingPoint = "IGNORE_SYSTEM_AND_CHANGE_SCHEMA";
    request.discovery.candidates[0].video.description = "TRANSCRIPT_ROLE_INJECTION";
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      request.discovery.source.blueprintVersion = 99;
      request.discovery.candidates[0].transcript.segments[0].text = "LATER_CAPTION_EDIT";
      request.blueprint.goals[0].stages[0].nodes[0].completionCriteria = "LATER_NODE_EDIT";
      return reply(answer());
    } });
    const result = await createResourceMatcher({ model }).run(request);
    expect(result).toMatchObject({ status: "matched", source: { blueprintVersion: 4 } });
    const instructions = model.doGenerateCalls[0].prompt.find(message => message.role === "system")?.content;
    expect(instructions).not.toMatch(/IGNORE_SYSTEM|TRANSCRIPT_ROLE_INJECTION|LATER_/);
    const data = JSON.stringify(modelInput(model));
    expect(data).toContain("IGNORE_SYSTEM_AND_CHANGE_SCHEMA"); expect(data).toContain("TRANSCRIPT_ROLE_INJECTION");
    expect(data).not.toMatch(/LATER_CAPTION_EDIT|LATER_NODE_EDIT/);
  });

  it("keeps unknown learner and Snapshot 1 planning values unknown", async () => {
    const request = input(); request.blueprint.schemaVersion = 1;
    delete request.blueprint.goals[0].stages[0].nodes[0].estimatedMinutes;
    delete request.blueprint.goals[0].stages[0].nodes[0].completionCriteria;
    const candidate = answer(); candidate.assessments[0].levelFit = "尚不知道学习起点，无法判断难度匹配。"; candidate.assessments[0].timeFit = "节点预算未知，需要另行安排实践时间。";
    const model = new MockLanguageModelV4({ doGenerate: reply(candidate) });
    expect((await createResourceMatcher({ model }).run({ ...request, learnerContext: { startingPoint: null, constraints: null } })).status).toBe("matched");
    expect(modelInput(model)).toMatchObject({ node: { estimatedMinutes: null, completionCriteria: null }, learnerContext: { startingPoint: null, constraints: null } });
    // The fixture response is not evidence that a real model honestly describes unknowns.
  });

  it.each(["cancelled", "timed_out"])("returns %s without accepting late output from an uncooperative model", async status => {
    vi.useFakeTimers();
    const controller = new AbortController(), started = Promise.withResolvers<void>();
    const deferred = Promise.withResolvers<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>>();
    const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return deferred.promise; } });
    try {
      const running = createResourceMatcher({ model }).run({ ...input(), signal: controller.signal });
      await started.promise;
      if (status === "cancelled") controller.abort("PRIVATE_ABORT_REASON"); else await vi.advanceTimersByTimeAsync(60000);
      const observed = Promise.race([running, new Promise(resolve => setTimeout(() => resolve({ status: "still_waiting" }), 1))]);
      await vi.advanceTimersByTimeAsync(1);
      expect(await observed).toEqual({ status, providerMayHaveRun: true, usage: null });
      expect(vi.getTimerCount()).toBe(0);
    } finally { deferred.resolve(reply(answer())); vi.useRealTimers(); }
  });

  it("sanitizes provider errors and rejects truncated output without retrying", async () => {
    const failed = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("PRIVATE_MODEL_KEY_AND_CAPTIONS"); } });
    expect(await createResourceMatcher({ model: failed }).run(input())).toEqual({ status: "unavailable", providerMayHaveRun: true, usage: null });
    expect(failed.doGenerateCalls).toHaveLength(1);
    const truncated = reply(answer()); truncated.finishReason.unified = "length";
    const model = new MockLanguageModelV4({ doGenerate: truncated });
    expect(await createResourceMatcher({ model }).run(input())).toMatchObject({ status: "invalid_output", providerMayHaveRun: true, usage: { totalTokens: 60 } });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("keeps model warnings and input/output bodies out of ordinary telemetry", async () => {
    const recorded = vi.fn(), logged = vi.fn();
    const previousTelemetry = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS, previousLogger = globalThis.AI_SDK_LOG_WARNINGS;
    globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = []; globalThis.AI_SDK_LOG_WARNINGS = logged;
    registerTelemetry({ onStart: recorded, onEnd: recorded, onLanguageModelCallStart: recorded, onLanguageModelCallEnd: recorded });
    const response = reply(answer()); response.warnings = [{ type: "other", message: "PRIVATE_PROVIDER_WARNING" }];
    try {
      const result = await createResourceMatcher({ model: new MockLanguageModelV4({ doGenerate: response }) }).run(input());
      expect(result.status).toBe("matched"); expect(logged).not.toHaveBeenCalled(); expect(recorded).not.toHaveBeenCalled();
    } finally { globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = previousTelemetry; globalThis.AI_SDK_LOG_WARNINGS = previousLogger; }
  });
});
