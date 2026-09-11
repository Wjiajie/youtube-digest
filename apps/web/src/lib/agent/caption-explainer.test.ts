import { expect, test, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { registerTelemetry } from "ai";
import { createCaptionExplainer } from "./caption-explainer";

const id = (n: number) => `fd820000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function input() { return {
  generationId: id(9), ownerId: id(1), signal: new AbortController().signal, sourceReadStartedAt: performance.now(),
  request: { bindingId: id(2), videoId: "abcdefghijk", sourceRunId: id(3), offset: 20 },
  selection: { start: { segmentIndex: 20, charOffset: 8 }, end: { segmentIndex: 20, charOffset: 35 } }, question: "这里为什么不能加倍？",
  transcript: { status: "ready", ownerId: id(1), context: { bindingId: id(2), nodeId: id(4), nodeTitle: "PRIVATE_NODE", goalId: id(5), goalTitle: "PRIVATE_GOAL", videoId: "abcdefghijk" },
    observedAt: "2026-09-11T00:00:00Z", sourceCreatedAt: "2026-09-10T00:00:00Z", contentExpiresAt: "2026-09-11T00:01:00Z",
    sourceRunId: id(3), sourceBlueprintVersion: 7, title: "PRIVATE_TITLE", language: "en", offset: 20, totalSegments: 22,
    segments: [{ text: "Notice: do not double ISO; compare two exposures.", offsetMs: 1250, durationMs: 2000 },
      { text: "Keep the shutter speed unchanged.", offsetMs: 3250, durationMs: 1000 }] },
}; }
function answer() { return { kind: "explanation", meaning: "原文要求不要将 ISO 翻倍，并比较两种曝光。", reasoning: "这一段提出比较步骤，但没有给出保持 ISO 的原因。",
  background: "一般摄影背景：ISO 设置会影响相机输出亮度；这不是此片段的新增证据。", checkQuestion: "比较时有哪些变量保持不变？",
  limitations: ["当前片段未交代不能加倍的原因。"], evidence: [{ segmentIndex: 20, quote: "do not double ISO" }] }; }
function reply(value: unknown): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> { return {
  content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: undefined },
  usage: { inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 40, text: 40, reasoning: undefined } }, warnings: [],
}; }
test("explains only a verified selection and preserves original evidence separate from general background", async () => {
  const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
  const result = await createCaptionExplainer({ model }).run(input());
  expect(result).toMatchObject({ status: "explained", generationId: id(9), providerMayHaveRun: true,
    usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 }, skill: { name: "blueprint-explain-selection", version: "1.0.0" },
    source: { ownerId: id(1), sourceRunId: id(3), contentExpiresAt: "2026-09-11T00:01:00Z" }, answer: answer(),
    selected: [{ segmentIndex: 20, startChar: 8, endChar: 35, text: "do not double ISO; compare ", offsetMs: 1250, durationMs: 2000 }],
  });
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toMatch(/PRIVATE_NODE|PRIVATE_GOAL|PRIVATE_TITLE|fd820000/);
});

test("a quote touching only selected whitespace is not evidence for the selected wording", async () => {
  const model = new MockLanguageModelV4({ doGenerate: reply({ ...answer(), evidence: [{ segmentIndex: 20, quote: " two exposures." }] }) });
  expect(await createCaptionExplainer({ model }).run(input())).toEqual({ status: "invalid_output", providerMayHaveRun: true,
    usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
});

test.each(["owner", "binding", "video", "source", "before-page", "after-page", "reversed", "past-text", "empty", "question", "future-clock"])(
  "refuses %s input before inference", async kind => {
    const request = input();
    if (kind === "owner") request.ownerId = id(99);
    if (kind === "binding") request.request.bindingId = id(99);
    if (kind === "video") request.request.videoId = "lmnopqrstuv";
    if (kind === "source") request.request.sourceRunId = id(99);
    if (kind === "before-page") request.selection.start.segmentIndex = 19;
    if (kind === "after-page") request.selection.end.segmentIndex = 22;
    if (kind === "reversed") request.selection.start.segmentIndex = 21;
    if (kind === "past-text") request.selection.end.charOffset = 100;
    if (kind === "empty") request.selection.end.charOffset = 8;
    if (kind === "question") request.question = "文".repeat(1001);
    if (kind === "future-clock") request.sourceReadStartedAt = performance.now() + 10000;
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    expect(await createCaptionExplainer({ model }).run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

test("keeps a cross-segment selection verbatim and cannot split a surrogate pair", async () => {
  const request = input(); request.transcript.segments[0]!.text = "A😀B";
  request.selection = { start: { segmentIndex: 20, charOffset: 1 }, end: { segmentIndex: 21, charOffset: 4 } };
  const model = new MockLanguageModelV4({ doGenerate: reply({ ...answer(), evidence: [{ segmentIndex: 20, quote: "😀B" }] }) });
  expect(await createCaptionExplainer({ model }).run(request)).toMatchObject({ status: "explained", selected: [
    { segmentIndex: 20, startChar: 1, endChar: 4, text: "😀B", offsetMs: 1250 },
    { segmentIndex: 21, startChar: 0, endChar: 4, text: "Keep", offsetMs: 3250 },
  ] });
  request.selection.start.charOffset = 2;
  expect(await createCaptionExplainer({ model }).run(request)).toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("bounds the selected span and sends nearby excerpts instead of the whole page", async () => {
  const request = input(); request.transcript.segments[0]!.text = "DISTANT_PRIVATE" + "x".repeat(1000) + "do not double ISO" + "y".repeat(1000) + "DISTANT_END";
  request.selection = { start: { segmentIndex: 20, charOffset: 1015 }, end: { segmentIndex: 20, charOffset: 1032 } };
  const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
  expect((await createCaptionExplainer({ model }).run(request)).status).toBe("explained");
  const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
  expect(prompt).not.toMatch(/DISTANT_PRIVATE|DISTANT_END/);
  expect(prompt).toContain("do not double ISO");
  request.selection.start.charOffset = 0; request.selection.end.charOffset = 2001;
  expect((await createCaptionExplainer({ model }).run(request)).status).toBe("invalid_input");
  request.transcript.segments = Array.from({ length: 6 }, () => ({ text: "x", offsetMs: 0, durationMs: 1 }));
  request.transcript.totalSegments = 26; request.selection.end = { segmentIndex: 25, charOffset: 1 };
  expect((await createCaptionExplainer({ model }).run(request)).status).toBe("invalid_input");
  expect(model.doGenerateCalls).toHaveLength(1);
});

test.each(["invented", "wrong-segment", "context-only", "duplicate", "empty", "extra-field", "oversized"])("rejects %s explanation output atomically", async kind => {
  const value = answer();
  if (kind === "invented") value.evidence[0]!.quote = "not in supplied text";
  if (kind === "wrong-segment") value.evidence[0]!.segmentIndex = 21;
  if (kind === "context-only") value.evidence = [{ segmentIndex: 21, quote: "Keep the shutter speed unchanged." }];
  if (kind === "duplicate") value.evidence.push({ ...value.evidence[0]! });
  if (kind === "empty") value.reasoning = "\n ";
  if (kind === "oversized") value.meaning = "文".repeat(2001);
  const model = new MockLanguageModelV4({ doGenerate: reply(kind === "extra-field" ? { ...value, ownerId: id(99) } : value) });
  expect(await createCaptionExplainer({ model }).run(input())).toEqual({ status: "invalid_output", providerMayHaveRun: true,
    usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("insufficient context is an explicit answer with provenance, not invented explanation or transport failure", async () => {
  const value = { kind: "insufficient_context", reason: "片段未给出比较结果。", missingContext: ["展示两种曝光结果的片段。"] };
  const model = new MockLanguageModelV4({ doGenerate: reply(value) });
  expect(await createCaptionExplainer({ model }).run(input())).toMatchObject({ status: "insufficient_context", answer: value,
    providerMayHaveRun: true, source: { evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
});

test("freezes selected evidence and question identity independently of later caller mutations and read time", async () => {
  const request = input(), next = input(); next.transcript.observedAt = "2026-09-11T00:00:05Z";
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    request.transcript.segments[0]!.text = "MUTATED"; request.question = "OTHER_QUESTION"; return reply(answer());
  } });
  const first = await createCaptionExplainer({ model }).run(request), second = await createCaptionExplainer({ model }).run(next);
  if (first.status !== "explained" || second.status !== "explained") throw new Error("Expected explanation");
  expect(first.selected[0]?.text).toBe("do not double ISO; compare ");
  expect(first.source.evidenceSha256).toBe(second.source.evidenceSha256); expect(first.requestSha256).toBe(second.requestSha256);
  next.question = "What does ISO mean?";
  const changed = await createCaptionExplainer({ model }).run(next);
  if (changed.status !== "explained") throw new Error("Expected explanation");
  expect(changed.source.evidenceSha256).toBe(first.source.evidenceSha256); expect(changed.requestSha256).not.toBe(first.requestSha256);
});

test.each(["before", "during"])("cancellation %s model work never accepts a late explanation", async when => {
  const request = input(), controller = new AbortController(); request.signal = controller.signal;
  const model = new MockLanguageModelV4({ doGenerate: async () => { controller.abort(); return reply(answer()); } });
  if (when === "before") controller.abort();
  expect(await createCaptionExplainer({ model }).run(request)).toMatchObject({ status: "cancelled", providerMayHaveRun: when === "during" });
  expect(model.doGenerateCalls).toHaveLength(when === "during" ? 1 : 0);
});

test.each(["source", "execution"])("a stalled provider stops on the %s deadline without retaining late material", async kind => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const started = Promise.withResolvers<void>(), result = Promise.withResolvers<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>>();
  const request = input(); request.transcript.contentExpiresAt = kind === "source" ? "2026-09-11T00:00:01Z" : "2026-09-11T00:02:00Z";
  const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return result.promise; } });
  const running = createCaptionExplainer({ model }).run(request);
  try {
    await started.promise; await vi.advanceTimersByTimeAsync(kind === "source" ? 1000 : 60000);
    expect(await running).toEqual({ status: kind === "source" ? "expired" : "timed_out", providerMayHaveRun: true, usage: null });
    expect(vi.getTimerCount()).toBe(0);
  } finally { result.resolve(reply(answer())); await running; vi.useRealTimers(); }
});

test("sanitizes provider failure, rejects truncation and unrecognized Skill without retrying", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("PRIVATE_KEY_OR_CAPTIONS"); } });
  expect(await createCaptionExplainer({ model }).run(input())).toEqual({ status: "unavailable", providerMayHaveRun: true, usage: null });
  expect(model.doGenerateCalls).toHaveLength(1);
  const result = reply(answer()); result.finishReason.unified = "length";
  const truncated = new MockLanguageModelV4({ doGenerate: result });
  expect((await createCaptionExplainer({ model: truncated }).run(input())).status).toBe("invalid_output");
  expect(await createCaptionExplainer({ model: truncated }).run({ ...input(), expectedSkillSha256: "0".repeat(64) }))
    .toEqual({ status: "unavailable", providerMayHaveRun: false, usage: null });
  expect(truncated.doGenerateCalls).toHaveLength(1);
});

test("unavailable or unpinned source material cannot start an explanation", async () => {
  const request = input(), model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
  for (const reason of ["not_acquired", "pending", "not_available", "expired", "cleared"]) {
    expect(await createCaptionExplainer({ model }).run({ ...request, transcript: { ownerId: request.ownerId,
      context: request.transcript.context, observedAt: request.transcript.observedAt, status: "unavailable", reason } }))
      .toEqual({ status: "no_evidence", providerMayHaveRun: false, usage: null });
  }
  expect(await createCaptionExplainer({ model }).run({ ...request, request: { ...request.request, sourceRunId: null, offset: 0 } }))
    .toEqual({ status: "invalid_input", providerMayHaveRun: false, usage: null });
  expect(model.doGenerateCalls).toHaveLength(0);
});

test("source freshness uses monotonic elapsed read time, including a result winning the expiry timer race", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(61000), wall = vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    const model = new MockLanguageModelV4({ doGenerate: reply(answer()) });
    expect(await createCaptionExplainer({ model }).run({ ...input(), sourceReadStartedAt: 0 }))
      .toEqual({ status: "expired", providerMayHaveRun: false, usage: null });
    expect(model.doGenerateCalls).toHaveLength(0);
    clock.mockReturnValue(0);
    const late = new MockLanguageModelV4({ doGenerate: async () => { clock.mockReturnValue(61000); return reply(answer()); } });
    expect(await createCaptionExplainer({ model: late }).run(input())).toEqual({ status: "expired", providerMayHaveRun: true,
      usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 } });
  } finally { clock.mockRestore(); wall.mockRestore(); }
});

test("private source and questions never enter telemetry or provider warning logs", async () => {
  const logged = vi.fn(), recorded = vi.fn(), oldTelemetry = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS, oldLogger = globalThis.AI_SDK_LOG_WARNINGS;
  globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = []; globalThis.AI_SDK_LOG_WARNINGS = logged;
  registerTelemetry({ onStart: recorded, onEnd: recorded, onLanguageModelCallStart: recorded, onLanguageModelCallEnd: recorded });
  try {
    const result = reply(answer()); result.warnings = [{ type: "other", message: "PRIVATE_SOURCE_QUESTION_KEY" }];
    const model = new MockLanguageModelV4({ doGenerate: result });
    expect((await createCaptionExplainer({ model }).run(input())).status).toBe("explained");
    expect(logged).not.toHaveBeenCalled(); expect(recorded).not.toHaveBeenCalled();
  } finally { globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = oldTelemetry; globalThis.AI_SDK_LOG_WARNINGS = oldLogger; }
});
