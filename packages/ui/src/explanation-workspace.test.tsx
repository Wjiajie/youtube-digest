// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ApplicationResult, LearningTranscript } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { LearningTranscriptReader } from "./learning-transcript";

const id = (n: number) => `bb860000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const page: Extract<LearningTranscript, { status: "ready" }> = {
  ownerId: id(1), context: { bindingId: id(2), nodeId: id(3), goalId: id(4), nodeTitle: "观察曝光", goalTitle: "记录光线", videoId: "abcdefghijk" },
  status: "ready", sourceRunId: id(5), sourceBlueprintVersion: 2, sourceCreatedAt: "2026-09-10T00:00:00Z",
  observedAt: "2026-09-11T00:00:00Z", contentExpiresAt: "2026-09-11T00:10:00Z", title: "Light and choices", language: "en", offset: 0, totalSegments: 2,
  segments: [{ text: "Observe the light ☀️", offsetMs: 65000, durationMs: 3000 }, { text: "Explain your choices.", offsetMs: 68000, durationMs: 3000 }],
};
let host: HTMLDivElement, root: Root;
let load: () => Promise<ApplicationResult<LearningTranscript>>;
const port = { find: vi.fn(async () => ({ ok: true, run: null })), start: vi.fn(), read: vi.fn(), cancel: vi.fn() };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  load = async () => ({ ok: true, value: structuredClone(page) });
  for (const action of Object.values(port)) action.mockClear();
  port.find.mockResolvedValue({ ok: true, run: null });
});

function response(runId: string, question = "") {
  return { ok: true, run: { runId, accountId: page.ownerId, status: "ready", context: { bindingId: page.context.bindingId,
    videoId: page.context.videoId, sourceRunId: page.sourceRunId, offset: 0 }, targetLanguage: "zh-Hans",
    contentExpiresAt: page.contentExpiresAt, observedAt: page.observedAt,
    selection: { start: { segmentIndex: 0, charOffset: 0 }, end: { segmentIndex: 0, charOffset: page.segments[0]!.text.length } }, question,
    result: { status: "explained", providerMayHaveRun: true, usage: null, answer: { kind: "explanation", meaning: "先观察光线。",
      reasoning: "原文要求先观察再作选择。", background: "这是通用观察练习，不是原文新增事实。", checkQuestion: "你看到了什么？",
      limitations: ["只有这两段上下文。"], evidence: [{ segmentIndex: 0, quote: "Observe the light" }] } } } };
}
test("an explicit explanation checks for existing work before one start and renders only source-checked answer sections", async () => {
  port.start.mockImplementation(async input => ({ ok: true, runId: input.runId, status: "ready" }));
  port.read.mockImplementation(async input => response(input.runId, "怎样练习？"));
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("怎样练习？");
  expect(port.start).not.toHaveBeenCalled(); await click("讲解这段原文");
  expect(port.start).toHaveBeenCalledTimes(1); expect(port.find).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("先观察光线。"); expect(host.textContent).toContain("一般背景");
  expect(host.textContent).toContain("只有这两段上下文。"); expect(host.textContent).toContain("引用对应原文不等于解释一定正确");
  await render("eastern"); expect(host.textContent).toContain("先观察光线。"); expect(port.start).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(theme: "cyberpunk" | "eastern" = "cyberpunk", ownerId = page.ownerId) {
  await act(async () => root.render(<ThemeSurface theme={theme}><LearningTranscriptReader accountId={ownerId}
    bindingId={page.context.bindingId} videoId={page.context.videoId} loadAction={load} explanation={port} /></ThemeSurface>));
}
function button(text: string) { const found = Array.from(host.querySelectorAll("button")).find(item => item.textContent === text); expect(found, text).toBeTruthy(); return found!; }
async function click(text: string) {
  await act(async () => button(text).click());
  if (["讲解这段原文", "核对原讲解", "查找已有讲解", "重发同一讲解请求", "重新尝试讲解", "取消讲解"].includes(text)) {
    // WebCrypto name-based IDs finish on a native async job, outside React's microtask queue.
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).not.toContain("正在核对讲解，离开不会自动重试。"); });
  }
}
async function question(text: string) {
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("whole-paragraph keyboard/touch selection preserves the private question through theme and source recheck without generation", async () => {
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解");
  expect(host.querySelector("blockquote")?.textContent).toBe("Observe the light ☀️");
  await question("怎么观察？"); await render("eastern");
  expect(host.querySelector("textarea")?.value).toBe("怎么观察？");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).not.toContain("Observe the light"); expect(host.querySelector("textarea")).toBeNull();
  await click("重新读取字幕");
  expect(host.querySelector("textarea")?.value).toBe("怎么观察？");
  expect(host.querySelector("blockquote")?.textContent).toBe("Observe the light ☀️");
  expect(port.start).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test("native selection uses exact original UTF-16 offsets and does not start a model request", async () => {
  await render(); await click("读取原始字幕");
  const original = host.querySelector('[data-explanation-segment="0"]')!;
  await act(async () => {
    const range = document.createRange(); range.setStart(original.firstChild!, 8); range.setEnd(original.firstChild!, 17);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    original.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  expect(host.querySelector("blockquote")?.textContent).toBe("the light"); expect(port.start).not.toHaveBeenCalled();
});

test("a cleared receipt removes the question and selection rather than leaving the old private draft on screen", async () => {
  port.read.mockImplementation(async input => { const value = response(input.runId); return { ok: true, run: { ...value.run, status: "cleared", selection: null, question: null, result: null, observedAt: null } }; });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("private question");
  await click("讲解这段原文");
  expect(host.querySelector("textarea")).toBeNull(); expect(host.querySelector("blockquote")).toBeNull();
  expect(host.textContent).toContain("讲解内容已清除");
});

test("a lost start reply stays bound across a recheck and recovers by reading, without new consumption", async () => {
  port.start.mockRejectedValue(new Error("network lost"));
  port.read.mockImplementation(async input => response(input.runId, input.question));
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("保持这个问题"); await click("讲解这段原文");
  expect(host.textContent).toContain("结果尚未确认"); expect(host.querySelector("textarea")?.disabled).toBe(true);
  const original = port.start.mock.calls[0]![0];
  await click("选择第 2 段讲解"); expect(host.querySelector("blockquote")?.textContent).toBe("Observe the light ☀️");
  await act(async () => window.dispatchEvent(new Event("focus"))); await click("重新读取字幕");
  expect(host.querySelector("textarea")?.value).toBe("保持这个问题"); await click("核对原讲解");
  expect(host.textContent).toContain("先观察光线。"); expect(port.read.mock.calls[0]![0]).toEqual(original); expect(port.start).toHaveBeenCalledTimes(1);
});

test("source expiry clears even a hidden unsubmitted draft; changing accounts cannot revive it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  load = async () => ({ ok: true, value: { ...page, contentExpiresAt: "2026-09-11T00:00:01Z" } });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("不应复活");
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => vi.advanceTimersByTime(1001)); await click("重新读取字幕");
  expect(host.querySelector("textarea")).toBeNull(); await click("选择第 1 段讲解");
  expect(host.querySelector("textarea")?.value).toBe(""); await render("eastern", id(99));
  expect(host.textContent).not.toContain("Observe the light"); expect(host.querySelector("textarea")).toBeNull();
});

test("an expired answer cannot leave the private question visible after a shorter fresh source observation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  port.start.mockImplementation(async input => ({ ok: true, runId: input.runId, status: "ready" }));
  port.read.mockImplementation(async input => { const value = response(input.runId, input.question); value.run.observedAt = "2026-09-11T00:09:59Z"; return value; });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("到期清除"); await click("讲解这段原文");
  expect(host.textContent).toContain("先观察光线。");
  await act(async () => vi.advanceTimersByTime(1001));
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("先观察光线。");
});

test("a pending lookup locks the selection, and a late start answer cannot overwrite an explicit cancellation", async () => {
  let resolveFind!: (value: { ok: true; run: null }) => void;
  port.find.mockImplementation(() => new Promise(resolve => { resolveFind = resolve; }));
  let resolveStart!: (value: unknown) => void;
  port.start.mockImplementation(() => new Promise(resolve => { resolveStart = resolve; }));
  port.cancel.mockImplementation(async input => ({ ok: true, runId: input.runId, status: "cancelled" }));
  port.read.mockImplementation(async input => { const value = response(input.runId); return { ok: true, run: { ...value.run, status: "cancelled", result: { status: "cancelled", providerMayHaveRun: true, usage: null } } }; });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解");
  await act(async () => button("讲解这段原文").click()); await click("选择第 2 段讲解");
  expect(host.querySelector("blockquote")?.textContent).toBe("Observe the light ☀️");
  await act(async () => resolveFind({ ok: true, run: null }));
  await vi.waitFor(async () => { await act(async () => {}); expect(port.start).toHaveBeenCalledTimes(1); });
  await click("取消讲解"); expect(host.textContent).toContain("本次讲解已取消");
  await act(async () => resolveStart({ ok: true, runId: port.start.mock.calls[0]![0].runId, status: "ready" }));
  expect(host.textContent).not.toContain("先观察光线。"); expect(host.textContent).toContain("本次讲解已取消"); expect(port.start).toHaveBeenCalledTimes(1);
});

test("invalid evidence is hidden and insufficient context is a complete but non-mastery result", async () => {
  port.start.mockImplementation(async input => ({ ok: true, runId: input.runId, status: "ready" }));
  port.read.mockImplementation(async input => { const value = response(input.runId); value.run.result.answer.evidence[0]!.quote = "invented words"; return value; });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await click("讲解这段原文");
  expect(host.textContent).not.toContain("先观察光线。"); expect(host.textContent).toContain("结果尚未确认");
  port.read.mockImplementation(async input => { const value = response(input.runId); return { ok: true, run: { ...value.run,
    result: { status: "insufficient_context", providerMayHaveRun: true, usage: null, answer: { kind: "insufficient_context", reason: "缺少示例画面。", missingContext: ["观察示例之间的差异。"] } } } }; });
  await click("核对原讲解"); expect(host.textContent).toContain("还需要一些上下文"); expect(host.textContent).toContain("缺少示例画面。");
  expect(port.start).toHaveBeenCalledTimes(1);
});

test("a definitive disabled first attempt leaves the unsubmitted question editable, but cannot unlock an earlier uncertain request", async () => {
  port.start.mockResolvedValue({ ok: false, code: "disabled" });
  await render(); await click("读取原始字幕"); await click("选择第 1 段讲解"); await question("先保留问题"); await click("讲解这段原文");
  expect(host.textContent).toContain("讲解暂未开启"); expect(host.querySelector("textarea")?.disabled).toBe(false);
  expect(host.querySelector("textarea")?.value).toBe("先保留问题");
  await click("选择第 2 段讲解"); expect(host.querySelector("blockquote")?.textContent).toBe("Explain your choices.");
  port.start.mockRejectedValue(new Error("unknown start")); await click("讲解这段原文");
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  port.start.mockResolvedValue({ ok: false, code: "disabled" }); await click("重发同一讲解请求");
  expect(host.querySelector("textarea")?.disabled).toBe(true); expect(button("核对原讲解")).toBeTruthy();
});
