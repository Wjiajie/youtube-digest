import { expect, it } from "vitest";
import type { TranscriptPage } from "./translation-view";
import { explanationAttemptId, explanationCommand, explanationResponse, parseExplanationView, selectedExplanationText } from "./explanation-view";

const account = "a6000000-0000-4000-8000-000000000001";
const binding = "a6000000-0000-4000-8000-000000000002";
const source = "a6000000-0000-4000-8000-000000000003";
const runId = "a6000000-0000-4000-8000-000000000004";
const selection = { start: { segmentIndex: 20, charOffset: 2 }, end: { segmentIndex: 20, charOffset: 6 } };
const page: TranscriptPage = { status: "ready", ownerId: account,
  context: { bindingId: binding, nodeId: runId, nodeTitle: "节点", goalId: runId, goalTitle: "目标", videoId: "abcdefghijk" },
  sourceRunId: source, sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-11T01:00:00Z", observedAt: "2026-09-11T01:01:00Z",
  contentExpiresAt: "2026-09-11T02:00:00Z", title: "选文", language: "zh", offset: 20, totalSegments: 22,
  segments: [{ text: "开始🚀示例结尾", offsetMs: 20_000, durationMs: 1000 }, { text: "下一句练习", offsetMs: 21_000, durationMs: 1000 }] };
const context = { bindingId: binding, videoId: "abcdefghijk", sourceRunId: source, offset: 20, targetLanguage: "zh-Hans" as const, selection, question: "说明一下" };
const answer = { kind: "explanation", meaning: "这是示例。", reasoning: "原文给出了示例。", background: null, checkQuestion: null,
  limitations: [], evidence: [{ segmentIndex: 20, quote: "示例" }] };
const view = { runId, accountId: account, status: "ready", context: { bindingId: binding, videoId: "abcdefghijk", sourceRunId: source, offset: 20 },
  targetLanguage: "zh-Hans", contentExpiresAt: page.contentExpiresAt, observedAt: page.observedAt, selection, question: context.question,
  result: { status: "explained", providerMayHaveRun: true, usage: null, answer } };

it("previews exact UTF-16 selection without splitting the learner's emoji", () => {
  expect(selectedExplanationText(page, selection)).toBe("🚀示例");
  expect(() => selectedExplanationText(page, { ...selection, start: { segmentIndex: 20, charOffset: 3 } })).toThrow();
});

it("accepts a private answer only for the exact learner, source, selection and question", () => {
  expect(parseExplanationView({ ok: true, run: view }, page, context, runId)).toEqual(view);
  expect(() => parseExplanationView({ ok: true, run: { ...view, question: "别的问题" } }, page, context, runId)).toThrow();
  expect(() => parseExplanationView({ ok: true, run: { ...view, accountId: binding } }, page, context, runId)).toThrow();
});

it("recovers the same attempt after a fresh observation but separates confirmed retries and exact drafts", async () => {
  const first = await explanationAttemptId(page, context, null);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await explanationAttemptId({ ...page, observedAt: "2026-09-11T01:02:00Z" }, structuredClone(context), null)).toBe(first);
  expect(await explanationAttemptId(page, { ...context, question: `${context.question} ` }, null)).not.toBe(first);
  expect(await explanationAttemptId(page, { ...context, selection: { ...selection, end: { segmentIndex: 20, charOffset: 7 } } }, null)).not.toBe(first);
  expect(await explanationAttemptId(page, context, runId)).not.toBe(first);
  await expect(explanationAttemptId(page, context, "unknown")).rejects.toThrow();
});

it.each(["queued", "running", "ready", "failed", "cancelled", "interrupted"])("requires live observation for %s private bodies", status => {
  const result = status === "queued" || status === "running" ? null : status === "ready" ? view.result
    : { status: status === "interrupted" ? "timed_out" : status === "cancelled" ? "cancelled" : "unavailable", providerMayHaveRun: false, usage: null };
  const current = { ...view, status, result };
  expect(parseExplanationView({ ok: true, run: current }, page, context)).toEqual(current);
  for (const observedAt of [null, page.contentExpiresAt, "2026-09-11T00:59:59Z"])
    expect(() => parseExplanationView({ ok: true, run: { ...current, observedAt } }, page, context)).toThrow();
});

it("accepts only a bodyless tombstone even without a source page available to the adapter", () => {
  const cleared = { ...view, status: "cleared", selection: null, question: null, result: null, observedAt: null };
  expect(explanationResponse.parse({ ok: true, run: cleared }).run).toEqual(cleared);
  for (const body of [{ selection }, { question: "private" }, { result: view.result }, { observedAt: page.observedAt }])
    expect(() => explanationResponse.parse({ ok: true, run: { ...cleared, ...body } })).toThrow();
});

it("rejects evidence outside bounded excerpts, duplicates and non-selected claims", () => {
  for (const evidence of [[{ segmentIndex: 21, quote: "下一句" }], [{ segmentIndex: 20, quote: "编造" }],
    [{ segmentIndex: 20, quote: "示例" }, { segmentIndex: 20, quote: "示例" }]])
    expect(() => parseExplanationView({ ok: true, run: { ...view, result: { ...view.result, answer: { ...answer, evidence } } } }, page, context)).toThrow();
  const longPage = { ...page, segments: [{ ...page.segments[0], text: `${"远".repeat(300)}证据${"近".repeat(300)}` }, page.segments[1]] };
  const longContext = { ...context, selection: { start: { segmentIndex: 20, charOffset: 300 }, end: { segmentIndex: 20, charOffset: 302 } } };
  const outside = { ...view, selection: longContext.selection, result: { ...view.result, answer: { ...answer,
    evidence: [{ segmentIndex: 20, quote: "远".repeat(257) }, { segmentIndex: 20, quote: "证据" }] } } };
  expect(() => parseExplanationView({ ok: true, run: outside }, longPage, longContext)).toThrow();
});

it("allows honest insufficient context but not mismatched ready outcomes or hidden persistence fields", () => {
  const insufficient = { ...view, result: { ...view.result, status: "insufficient_context", answer: {
    kind: "insufficient_context", reason: "缺少参数。", missingContext: ["拍摄设置"] } } };
  expect(parseExplanationView({ ok: true, run: insufficient }, page, context)).toEqual(insufficient);
  expect(() => parseExplanationView({ ok: true, run: { ...insufficient, result: { ...insufficient.result, status: "explained" } } }, page, context)).toThrow();
  expect(() => parseExplanationView({ ok: true, run: { ...view, input_page: page } }, page, context)).toThrow();
});

it("limits selection to five paragraphs and 2000 UTF-16 characters with no empty or inverted selection", () => {
  for (const invalid of [{ start: { segmentIndex: 19, charOffset: 0 }, end: selection.end },
    { start: selection.end, end: selection.start }, { start: selection.start, end: selection.start },
    { start: selection.start, end: { segmentIndex: 20, charOffset: 100 } }]) expect(() => selectedExplanationText(page, invalid)).toThrow();
  const larger = { ...page, totalSegments: 26, segments: Array.from({ length: 6 }, () => ({ text: "段落", offsetMs: 0, durationMs: 1 })) };
  expect(selectedExplanationText(larger, { start: { segmentIndex: 20, charOffset: 0 }, end: { segmentIndex: 24, charOffset: 2 } })).toBe("段落\n段落\n段落\n段落\n段落");
  expect(() => selectedExplanationText(larger, { start: { segmentIndex: 20, charOffset: 0 }, end: { segmentIndex: 25, charOffset: 1 } })).toThrow();
  const lengthy = { ...page, segments: [{ text: "文".repeat(2001), offsetMs: 0, durationMs: 1 }] };
  expect(selectedExplanationText(lengthy, { start: { segmentIndex: 20, charOffset: 0 }, end: { segmentIndex: 20, charOffset: 2000 } })).toHaveLength(2000);
  expect(() => selectedExplanationText(lengthy, { start: { segmentIndex: 20, charOffset: 0 }, end: { segmentIndex: 20, charOffset: 2001 } })).toThrow();
});

it("keeps runtime messages closed and preserves exact valid question whitespace", () => {
  expect(explanationCommand.parse({ operation: "find", context: { ...context, question: "  " } }).context.question).toBe("  ");
  for (const question of ["x".repeat(1001), "\ud800", "\0"])
    expect(() => explanationCommand.parse({ operation: "find", context: { ...context, question } })).toThrow();
  expect(() => explanationCommand.parse({ operation: "start", context })).toThrow();
  expect(() => explanationCommand.parse({ operation: "find", context: { ...context, transcript: "private" } })).toThrow();
});
