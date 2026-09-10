// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ApplicationResult, LearningTranscript, LearningTranscriptRequest } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { LearningTranscriptReader } from "./learning-transcript";

const id = (n: number) => `ef680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), binding = id(2), source = id(3), video = "abcdefghijk";
const page: LearningTranscript = { ownerId: owner, context: { bindingId: binding, nodeId: id(4), nodeTitle: "观察曝光", goalId: id(5), goalTitle: "记录光线", videoId: video },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: source, sourceBlueprintVersion: 2, sourceCreatedAt: "2026-09-10T00:00:00Z",
  contentExpiresAt: "2026-09-11T00:10:00Z", title: "Understanding exposure", language: "en", offset: 0, totalSegments: 1,
  segments: [{ text: "  <img src=x onerror=alert(1)> Exposure  ", offsetMs: 65000, durationMs: 3000 }] };
let host: HTMLDivElement, root: Root, requests: LearningTranscriptRequest[];
let load: (input: LearningTranscriptRequest) => Promise<ApplicationResult<LearningTranscript>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); requests = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  load = async input => { requests.push(input); return { ok: true, value: structuredClone(page) }; };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(accountId = owner, bindingId = binding, theme: "cyberpunk" | "eastern" = "cyberpunk") {
  await act(async () => root.render(<ThemeSurface theme={theme}><LearningTranscriptReader accountId={accountId} bindingId={bindingId} videoId={video} loadAction={load} /></ThemeSurface>));
}
function button(text: string) { return Array.from(host.querySelectorAll("button")).find(item => item.textContent === text)!; }
async function click(text: string) { await act(async () => button(text).click()); }

test("explicitly reads original captions as plain text, with a safe timestamp link and no persistence", async () => {
  await render(); expect(requests).toEqual([]); expect(host.textContent).not.toContain("Exposure");
  await click("读取原始字幕");
  expect(requests).toEqual([{ bindingId: binding, videoId: video, sourceRunId: null, offset: 0 }]);
  expect(host.textContent).toContain("<img src=x onerror=alert(1)> Exposure"); expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=65s");
  expect(host.textContent).toContain("历史获取材料"); expect(host.textContent).toContain("en");
  expect(localStorage.length).toBe(0);
});

test("paginates one fixed source and preserves the reading page through a theme switch", async () => {
  load = async input => {
    requests.push(input);
    return { ok: true, value: { ...page, status: "ready", offset: input.offset, totalSegments: 21,
      segments: input.offset === 0 ? Array.from({ length: 20 }, (_, index) => ({ text: `Line ${index + 1}`, offsetMs: index * 1000, durationMs: 1000 }))
        : [{ text: "Final line", offsetMs: 21000, durationMs: 1000 }] } };
  };
  await render(); await click("读取原始字幕"); expect(button("上一页").disabled).toBe(true);
  await click("下一页"); expect(requests[1]).toEqual({ bindingId: binding, videoId: video, sourceRunId: source, offset: 20 });
  expect(host.textContent).toContain("第 21–21 段 / 共 21 段"); expect(button("下一页").disabled).toBe(true);
  await render(owner, binding, "eastern"); expect(host.textContent).toContain("Final line"); expect(requests).toHaveLength(2);
  await click("上一页"); expect(requests[2]?.sourceRunId).toBe(source); expect(requests[2]?.offset).toBe(0);
});

test("subtracts the whole read latency from database lifetime, then removes expired body without reloading", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let resolve!: (value: ApplicationResult<LearningTranscript>) => void;
  load = input => { requests.push(input); return new Promise(done => { resolve = done; }); };
  await render(); await click("读取原始字幕");
  await act(async () => { vi.advanceTimersByTime(750); resolve({ ok: true, value: { ...page, contentExpiresAt: "2026-09-11T00:00:01Z" } }); });
  expect(host.textContent).toContain("Exposure");
  await act(async () => vi.advanceTimersByTime(251));
  expect(host.textContent).not.toContain("Exposure"); expect(host.textContent).toContain("字幕使用期限已到"); expect(requests).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});

test("returning to the window hides materials and discards an older in-flight response until explicit reread", async () => {
  let resolve!: (value: ApplicationResult<LearningTranscript>) => void;
  load = input => { requests.push(input); return new Promise(done => { resolve = done; }); };
  await render(); await click("读取原始字幕");
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => resolve({ ok: true, value: page }));
  expect(host.textContent).not.toContain("Exposure"); expect(host.textContent).toContain("重新核对"); expect(requests).toHaveLength(1);
});

test("account or binding changes discard old material and do not move private records or auto-fetch", async () => {
  await render(); await click("读取原始字幕"); expect(host.textContent).toContain("Exposure");
  await render(owner, id(22)); expect(host.textContent).not.toContain("Exposure"); expect(requests).toHaveLength(1);
  await render(id(99), binding); expect(host.textContent).not.toContain("Exposure"); expect(requests).toHaveLength(1);
});
