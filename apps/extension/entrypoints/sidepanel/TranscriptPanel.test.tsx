// @vitest-environment jsdom
import { act } from "react";
import { createHash } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TranscriptPanel } from "./TranscriptPanel";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { runtime: transport } }));
const id = (n: number) => `fd680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ownerId = id(1), context = { resourceBindingId: id(2), nodeId: id(3), videoId: "abcdefghijk" };
const page = { ownerId, context: { bindingId: id(2), nodeId: id(3), nodeTitle: "节点", goalId: id(4), goalTitle: "目标", videoId: context.videoId },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: id(5), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
  contentExpiresAt: "2026-09-12T00:00:00Z", title: "历史原始材料", language: "zh", offset: 0, totalSegments: 1,
  segments: [{ text: "原文 <img src=x> 保持文本", offsetMs: 1200.5, durationMs: 300 }] };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); transport.sendMessage.mockReset();
  vi.stubGlobal("crypto", { subtle: { digest: async (_algorithm: string, data: Uint8Array) => createHash("sha256").update(data).digest() } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function read() {
  const button = [...host.querySelectorAll("button")].find(item => ["读取原始字幕", "重新读取字幕"].includes(item.textContent ?? ""));
  expect(button).toBeDefined(); await act(async () => button!.click());
}

test("understanding requires a selected binding and reads its real page only after explicit action", async () => {
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={7} />));
  expect(host.textContent).toContain("选择本次学习节点"); expect(host.querySelector("button")).toBeNull();
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={7} context={context} />));
  expect(transport.sendMessage).not.toHaveBeenCalled();
  transport.sendMessage.mockResolvedValue({ ok: true, value: page });
  await read();
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.type === "LOAD_LEARNING_TRANSCRIPT").map(([message]) => message))
    .toEqual([{ type: "LOAD_LEARNING_TRANSCRIPT", ownerId, expectedTabId: 7, nodeId: context.nodeId,
      input: { bindingId: context.resourceBindingId, videoId: context.videoId, sourceRunId: null, offset: 0 } }]);
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.input?.operation === "start")).toHaveLength(0);
  expect(host.textContent).toContain("原文 <img src=x> 保持文本"); expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("a")?.href).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=1s");
});

test("context, tab and owner changes discard a late page without reading the new context automatically", async () => {
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={7} context={context} />));
  await read();
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={8} context={context} />));
  await act(async () => release({ ok: true, value: page }));
  expect(host.textContent).not.toContain("历史原始材料"); expect(transport.sendMessage).toHaveBeenCalledTimes(1);
  transport.sendMessage.mockResolvedValue({ ok: true, value: page }); await read();
  expect(host.textContent).toContain("历史原始材料");
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={8} context={{ ...context, resourceBindingId: id(8), nodeId: id(9) }} />));
  expect(host.textContent).not.toContain("历史原始材料");
  await act(async () => root.render(<TranscriptPanel ownerId={id(10)} expectedTabId={8} context={context} />));
  expect(host.textContent).not.toContain("历史原始材料");
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.type === "LOAD_LEARNING_TRANSCRIPT")).toHaveLength(2);
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.input?.operation === "start")).toHaveLength(0);
});

test("a wrong-node page or transport failure hides material and requires another explicit read", async () => {
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={7} context={context} />));
  transport.sendMessage.mockResolvedValue({ ok: true, value: { ...page, context: { ...page.context, nodeId: id(9) } } });
  await read(); expect(host.textContent).not.toContain("历史原始材料");
  transport.sendMessage.mockRejectedValue(new TypeError("network unavailable"));
  await read(); expect(host.textContent).not.toContain("历史原始材料"); expect(host.textContent).not.toContain("network unavailable");
  expect(transport.sendMessage).toHaveBeenCalledTimes(2);
});

test("extension panel explicitly reads, finds and translates through the shared recoverable reader", async () => {
  const source = { ...page, language: "en", segments: [{ text: "Compare two examples.", offsetMs: 1000, durationMs: 1000 }] };
  let runId: string | null = null;
  transport.sendMessage.mockImplementation(async message => {
    if (message.type === "LOAD_LEARNING_TRANSCRIPT") return { ok: true, value: source };
    expect(message).toMatchObject({ type: "LEARNING_TRANSLATION", ownerId, expectedTabId: 7, nodeId: context.nodeId });
    if (message.input.operation === "find") return { ok: true, run: null };
    if (message.input.operation === "start") { runId = message.input.runId; return { ok: true, runId, status: "ready" }; }
    return { ok: true, run: { runId, accountId: ownerId, status: "ready", context: { bindingId: context.resourceBindingId, videoId: context.videoId, sourceRunId: id(5), offset: 0 },
      targetLanguage: "zh-Hans", observedAt: page.observedAt, contentExpiresAt: page.contentExpiresAt,
      result: { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 0, translation: "比较两个示例。" }] } } };
  });
  await act(async () => root.render(<TranscriptPanel ownerId={ownerId} expectedTabId={7} context={context} />));
  expect(transport.sendMessage).not.toHaveBeenCalled(); await read();
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.input?.operation === "start")).toHaveLength(0);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "翻译当前页")!.click());
  expect(host.textContent).toContain("比较两个示例。"); expect(host.textContent).toContain("Compare two examples.");
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.input?.operation === "start")).toHaveLength(1);
});
