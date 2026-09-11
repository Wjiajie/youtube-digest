/// <reference types="node" />
// @vitest-environment jsdom
import { act } from "react";
import { createHash } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LearningTranscript } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { LearningTranscriptReader } from "./learning-transcript";

const id = (n: number) => `ef790000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accountId = id(1), bindingId = id(2), sourceRunId = id(3), videoId = "abcdefghijk";
const context = { bindingId, videoId, sourceRunId, offset: 0 };
const page: Extract<LearningTranscript, { status: "ready" }> = { ownerId: accountId, status: "ready", context: {
  bindingId, videoId, nodeId: id(4), goalId: id(5), nodeTitle: "观察光线", goalTitle: "摄影作品" },
  sourceRunId, sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z", observedAt: "2026-09-11T00:00:00Z",
  contentExpiresAt: "2026-09-11T00:10:00Z", title: "Exposure", language: "en", offset: 0, totalSegments: 1,
  segments: [{ text: "Observe the light.", offsetMs: 65000, durationMs: 3000 }] };
function ready(runId: string) { return { ok: true, run: { runId, accountId, status: "ready", context, targetLanguage: "zh-Hans",
  contentExpiresAt: page.contentExpiresAt, observedAt: page.observedAt,
  result: { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 0, translation: "观察光线。<img src=x>" }] } } }; }
let host: HTMLDivElement, root: Root;
let starts: Array<{ runId: string }>, reads: string[];
let translation: { find(input: unknown, signal: AbortSignal): Promise<unknown>; start(input: { runId: string }, signal: AbortSignal): Promise<unknown>;
  read(runId: string, signal: AbortSignal): Promise<unknown>; cancel(runId: string, signal: AbortSignal): Promise<unknown> };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); starts = []; reads = [];
  // jsdom has no SubtleCrypto. The external crypto adapter uses the actual SHA-256 algorithm.
  vi.stubGlobal("crypto", { subtle: { digest: async (_algorithm: string, data: Uint8Array) => createHash("sha256").update(data).digest() } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  translation = { find: async () => ({ ok: true, run: null }), start: async command => { starts.push(command); return { ok: true, runId: command.runId, status: "ready" }; },
    read: async runId => { reads.push(runId); return ready(runId); }, cancel: async runId => ({ ok: true, runId, status: "cancelled" }) };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(theme: "cyberpunk" | "eastern" = "cyberpunk") {
  await act(async () => root.render(<ThemeSurface theme={theme}><LearningTranscriptReader accountId={accountId} bindingId={bindingId} videoId={videoId}
    loadAction={async () => ({ ok: true, value: page })} translation={translation} /></ThemeSurface>));
}
async function click(label: string) { await act(async () => {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  expect(button, `Missing ${label}`).toBeDefined(); button!.click();
}); }

test("explicitly translates a page, pairs plain text with original captions and preserves it across themes", async () => {
  await render(); expect(starts).toEqual([]);
  await click("读取原始字幕"); expect(starts).toEqual([]);
  await click("翻译当前页");
  expect(starts).toHaveLength(1); expect(starts[0]).toMatchObject({ ...context, targetLanguage: "zh-Hans" });
  expect(reads).toEqual([starts[0].runId]);
  expect(host.textContent).toContain("Observe the light."); expect(host.textContent).toContain("观察光线。<img src=x>");
  expect(host.querySelector("img")).toBeNull(); expect(localStorage.length).toBe(0);
  await render("eastern"); expect(host.textContent).toContain("观察光线。"); expect(starts).toHaveLength(1);
});

test("an unknown start keeps its request identity and recovers without generating again", async () => {
  translation.start = async command => { starts.push(command); throw new Error("connection lost after acceptance"); };
  await render(); await click("读取原始字幕"); await click("翻译当前页");
  expect(host.textContent).toContain("结果尚未确认");
  await click("核对当前翻译");
  expect(host.textContent).toContain("观察光线。"); expect(starts).toHaveLength(1); expect(reads).toEqual([starts[0].runId]);
});

test("cloud recovery subtracts its roundtrip from the remaining translation lifetime", async () => {
  vi.useFakeTimers(); let elapsed = 0; vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  translation.find = async () => { elapsed = 750; const value = ready(id(8)); value.run.observedAt = "2026-09-11T00:09:59Z"; return value; };
  await render(); await click("读取原始字幕"); expect(host.textContent).toContain("观察光线。"); expect(starts).toEqual([]);
  elapsed = 1001; await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  expect(host.textContent).not.toContain("观察光线。<img"); expect(host.textContent).toContain("译文使用期限已到");
  expect(host.textContent).toContain("Observe the light.");
});

test("cancels an in-flight request separately and ignores a late start acknowledgment", async () => {
  let finishStart: (value: unknown) => void = () => {};
  translation.start = command => { starts.push(command); return new Promise(resolve => { finishStart = resolve; }); };
  translation.read = async runId => ({ ...ready(runId), run: { ...ready(runId).run, status: "cancelled", observedAt: null,
    result: { status: "cancelled", providerMayHaveRun: true, usage: null } } });
  await render(); await click("读取原始字幕"); await click("翻译当前页"); await click("取消当前翻译");
  expect(host.textContent).toContain("已取消"); expect(host.textContent).toContain("不保证撤销已发生的费用");
  await act(async () => finishStart({ ok: true, runId: starts[0].runId, status: "ready" }));
  expect(host.textContent).not.toContain("观察光线。<img"); expect(starts).toHaveLength(1);
});

test("an unresolved wait ends visibly and resending keeps exactly the same request", async () => {
  vi.useFakeTimers();
  translation.start = command => { starts.push(command); return new Promise(() => {}); };
  await render(); await click("读取原始字幕"); await click("翻译当前页");
  await act(async () => { await vi.advanceTimersByTimeAsync(95_001); });
  expect(host.textContent).toContain("结果尚未确认");
  translation.start = async command => { starts.push(command); return { ok: true, runId: command.runId, status: "ready" }; };
  await click("重发同一请求"); expect(starts).toHaveLength(2); expect(starts[1]).toEqual(starts[0]);
  expect(host.textContent).toContain("观察光线。<img");
});

test("returning to the tab aborts old work and requires fresh source and cloud reads", async () => {
  let release: (value: unknown) => void = () => {}, signal: AbortSignal | undefined;
  translation.find = async (_input, inputSignal) => { signal = inputSignal; return new Promise(resolve => { release = resolve; }); };
  await render(); await click("读取原始字幕");
  await act(async () => window.dispatchEvent(new Event("focus"))); expect(signal?.aborted).toBe(true);
  await act(async () => release(ready(id(8))));
  expect(host.textContent).not.toContain("观察光线。<img"); expect(host.textContent).not.toContain("Observe the light.");
  expect(host.textContent).toContain("重新核对字幕"); expect(starts).toHaveLength(0);
});

test.each([
  { accountId: id(9) }, { context: { ...context, sourceRunId: id(9) } }, { context: { ...context, offset: 20 } },
  { contentExpiresAt: "2026-09-12T00:10:00Z" }, { skill: { instructions: "private" } }, { status: "running" },
  { result: { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 1, translation: "wrong index" }] } },
])("rejects mismatched or private translation projections %#", async patch => {
  translation.find = async () => ({ ok: true, run: { ...ready(id(8)).run, ...patch } });
  await render(); await click("读取原始字幕");
  expect(host.textContent).toContain("结果尚未确认"); expect(host.textContent).not.toContain("观察光线。<img");
  expect(host.textContent).toContain("Observe the light."); expect(starts).toHaveLength(0);
});

test("a failed cloud lookup cannot accidentally create a second generation", async () => {
  translation.find = async () => { throw new Error("cloud unavailable"); };
  await render(); await click("读取原始字幕");
  const start = [...host.querySelectorAll("button")].find(button => button.textContent === "翻译当前页");
  expect(start?.disabled).toBe(true);
  translation.find = async () => ({ ok: true, run: null }); await click("查找已有翻译");
  await click("翻译当前页"); expect(starts).toHaveLength(1);
});

test("an unknown start survives a reader remount even before the cloud record becomes visible", async () => {
  translation.start = async command => { starts.push(command); throw new Error("begin acknowledgment pending"); };
  await render(); await click("读取原始字幕"); await click("翻译当前页");
  await act(async () => root.render(null)); await render(); await click("读取原始字幕"); await click("翻译当前页");
  expect(starts).toHaveLength(2); expect(starts[1].runId).toBe(starts[0].runId);
});

test("an unknown retry of a confirmed terminal run keeps its successor identity across remounts", async () => {
  translation.find = async () => ({ ...ready(id(8)), run: { ...ready(id(8)).run, status: "failed", observedAt: null,
    result: { status: "invalid_output", providerMayHaveRun: true, usage: null } } });
  translation.start = async command => { starts.push(command); throw new Error("retry not visible yet"); };
  await render(); await click("读取原始字幕"); await click("重新尝试翻译");
  await act(async () => root.render(null)); await render(); await click("读取原始字幕"); await click("重新尝试翻译");
  expect(starts).toHaveLength(2); expect(starts[1].runId).toBe(starts[0].runId); expect(starts[0].runId).not.toBe(id(8));
});
