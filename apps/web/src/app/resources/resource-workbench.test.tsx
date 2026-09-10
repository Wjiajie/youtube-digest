// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResourceNodeWorkbench, ResourceRunReview } from "./resource-workbench";
import type { ResourceNodeView, ResourceRunView, ResourceRunReviewProps } from "./resource-view";

const accountId = "10000000-0000-4000-8000-000000000001", nodeId = "10000000-0000-4000-8000-000000000002", runId = "10000000-0000-4000-8000-000000000003";
const node: ResourceNodeView = { nodeId, nodeTitle: "PRIVATE_NODE", goalId: accountId, goalTitle: "PRIVATE_GOAL", blueprintVersion: 3,
  description: "理解基本概念", completionCriteria: "独立解释一个实例", estimatedMinutes: 45,
  records: [{ id: runId, kind: "discover", createdAt: "2026-09-10T03:00:00Z" }], offset: 0, hasMore: false };
const run: Exclude<ResourceRunView, { status: "cleared" }> = { id: runId, nodeId, nodeTitle: node.nodeTitle, goalId: node.goalId, goalTitle: node.goalTitle,
  blueprintVersion: 3, kind: "discover", sourceRunId: null, childId: null, nextKind: null, status: "running",
  createdAt: "2026-09-10T03:00:00Z", expiresAt: "2026-09-10T03:02:00Z", preferences: { regionCode: "US", language: "zh", allowLanguageFallback: false,
    maxDurationSeconds: 1800, publishedAfter: null }, learnerContext: { startingPoint: null, constraints: null }, skillVersion: null, result: null };
function props(overrides: Partial<ResourceRunReviewProps> = {}): ResourceRunReviewProps {
  return { accountId, initial: run, enabled: true, readAction: async () => ({ ok: true, value: run }), cancelAction: async () => ({ ok: true, value: { ...run, status: "cancelled" } }), ...overrides };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(element => element.textContent === text)!;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function enter(label: string, value: string) {
  await act(async () => { const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function selectLanguage(value: string) {
  await act(async () => {
    const element = host.querySelector<HTMLSelectElement>('select[aria-label="字幕语言"]')!;
    expect(element).not.toBeNull(); element.value = value; element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("keeps source context and history available while resource execution is off by default", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled={false} />));
  expect(host.textContent).toContain("PRIVATE_NODE"); expect(host.textContent).toContain("独立解释一个实例");
  expect(host.textContent).toContain("资源服务暂未启用"); expect(button("查找视频").disabled).toBe(true);
  expect(host.querySelector(`a[href="/resources/${runId}"]`)).not.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it("requires an explicit region and keeps a stable recovery link while a single discovery request is unresolved", async () => {
  const network = deferred<Response>(), fetcher = vi.fn<typeof fetch>(() => network.promise); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled />));
  expect(button("查找视频").disabled).toBe(true);
  await enter("观看地区代码", "US"); await enter("单个视频时长上限（分钟）", "30");
  await act(async () => button("查找视频").click());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const options = fetcher.mock.calls[0][1] as RequestInit, command = JSON.parse(String(options.body));
  expect(command).toEqual({ accountId, kind: "discover", runId: expect.any(String), nodeId, expectedBlueprintVersion: 3,
    preferences: { regionCode: "US", language: "zh", allowLanguageFallback: false, maxDurationSeconds: 1800, publishedAfter: null }, learnerContext: { startingPoint: null, constraints: null } });
  const link = host.querySelector<HTMLAnchorElement>(`a[href="/resources/${command.runId}"]`)!;
  expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener"); expect(button("查找视频").disabled).toBe(true);
  await act(async () => network.resolve(new Response("gateway failure", { status: 502 })));
  expect(host.textContent).toContain("结果尚未确认"); expect(link.isConnected).toBe(true); expect(button("查找视频").disabled).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("allows read and cancellation with execution disabled and ignores an earlier read arriving after cancellation", async () => {
  const reading = deferred<Awaited<ReturnType<ResourceRunReviewProps["readAction"]>>>();
  const readAction = vi.fn(() => reading.promise), cancelAction = vi.fn(async () => ({ ok: true as const, value: { ...run, status: "cancelled" as const } }));
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceRunReview {...props({ enabled: false, readAction, cancelAction })} />));
  expect(readAction).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  await act(async () => button("读取最新状态").click());
  expect(button("取消本次运行").disabled).toBe(false);
  await act(async () => button("取消本次运行").click());
  expect(host.textContent).toContain("已取消");
  await act(async () => reading.resolve({ ok: true, value: run }));
  expect(host.textContent).toContain("已取消"); expect(button("取消本次运行")).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
});
const candidate: NonNullable<ResourceRunView["result"]>["candidates"][number] = { videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk",
  title: "<img src=x onerror=alert(1)>PRIVATE_VIDEO", channel: "[channel](https://untrusted.example)", publishedAt: "2025-01-02T00:00:00Z", durationSeconds: 300,
  transcriptStatus: "ready", language: "zh", languageFallback: false, eligible: true, assessment: null };
const discovered: ResourceRunView = { ...run, status: "ready", nextKind: "match", result: { status: "discovered", summary: null, candidates: [candidate], rejected: [], uninspectedCount: 2 } };
it("requires confirmation before clearing and hides old evidence during an unknown clear outcome", async () => {
  const pending = deferred<Awaited<ReturnType<ResourceRunReviewProps["readAction"]>>>();
  const clearAction = vi.fn(() => pending.promise);
  await act(async () => root.render(<ResourceRunReview {...props({ initial: discovered, enabled: false, clearAction })} />));
  expect(clearAction).not.toHaveBeenCalled();
  expect(button("清除这条检索链的证据")).toBeDefined();
  await act(async () => button("清除这条检索链的证据").click());
  expect(host.textContent).toContain("不可恢复");
  expect(clearAction).not.toHaveBeenCalled();
  await act(async () => button("确认清除证据").click());
  expect(host.textContent).not.toContain("PRIVATE_VIDEO");
  expect(host.textContent).not.toContain("PRIVATE_NODE");
  await act(async () => pending.resolve({ ok: false, code: "unavailable" }));
  expect(host.textContent).not.toContain("PRIVATE_VIDEO");
  expect(host.textContent).toContain("结果尚未确认");
  expect(button("确认清除证据")).toBeUndefined();
  expect(clearAction).toHaveBeenCalledTimes(1);
});
const cleared: ResourceRunView = { id: runId, nodeId, blueprintVersion: 3, sourceRunId: null, status: "cleared", clearedAt: "2026-09-11T01:00:00Z", result: null };
it("recovers an uncertain clear by reading without restoring old evidence or making another clear request", async () => {
  const clearAction = vi.fn(async () => { throw new Error("lost response"); });
  const readAction = vi.fn(async () => ({ ok: true as const, value: cleared }));
  await act(async () => root.render(<ResourceRunReview {...props({ initial: discovered, clearAction, readAction })} />));
  await act(async () => button("清除这条检索链的证据").click());
  await act(async () => button("确认清除证据").click());
  expect(host.textContent).not.toContain("PRIVATE_VIDEO");
  await act(async () => button("读取最新状态").click());
  expect(host.textContent).toContain("资源证据已清除");
  expect(host.textContent).not.toContain("PRIVATE_NODE");
  expect(button("生成匹配建议")).toBeUndefined();
  expect(clearAction).toHaveBeenCalledTimes(1); expect(readAction).toHaveBeenCalledTimes(1);
});
it("an earlier read cannot restore evidence after an explicit clear", async () => {
  const pending = deferred<Awaited<ReturnType<ResourceRunReviewProps["readAction"]>>>();
  await act(async () => root.render(<ResourceRunReview {...props({ initial: discovered, readAction: () => pending.promise,
    clearAction: async () => ({ ok: true, value: cleared }) })} />));
  await act(async () => button("读取最新状态").click());
  await act(async () => button("清除这条检索链的证据").click());
  await act(async () => button("确认清除证据").click());
  await act(async () => pending.resolve({ ok: true, value: discovered }));
  expect(host.textContent).toContain("资源证据已清除"); expect(host.textContent).not.toContain("PRIVATE_VIDEO");
});
it("retaining evidence is nonmutating and a foreign account never receives a late clear result", async () => {
  const pending = deferred<Awaited<ReturnType<ResourceRunReviewProps["readAction"]>>>();
  const clearAction = vi.fn(() => pending.promise), initialProps = props({ initial: discovered, clearAction });
  await act(async () => root.render(<ResourceRunReview {...initialProps} />));
  await act(async () => button("清除这条检索链的证据").click());
  await act(async () => button("保留证据").click());
  expect(clearAction).not.toHaveBeenCalled(); expect(host.textContent).toContain("PRIVATE_VIDEO");
  await act(async () => button("清除这条检索链的证据").click());
  await act(async () => button("确认清除证据").click());
  await act(async () => root.render(<ResourceRunReview {...initialProps} accountId="20000000-0000-4000-8000-000000000001" />));
  await act(async () => pending.resolve({ ok: true, value: cleared }));
  expect(host.textContent).toContain("身份已变化"); expect(host.textContent).not.toContain("资源证据已清除");
});
it("executes exactly one explicit next phase from saved identity with immediate recovery and no raw evidence payload", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => { const command = JSON.parse(String(init?.body)); return Response.json({ ok: true, runId: command.runId, status: "ready" }); });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceRunReview {...props({ initial: discovered })} />));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => button("生成匹配建议").click());
  const [url, init] = fetcher.mock.calls[0], command = JSON.parse(String(init?.body));
  expect(url).toBe("/api/resources/runs"); expect(command).toEqual({ accountId, kind: "match", runId: expect.any(String), sourceRunId: runId });
  expect(button("生成匹配建议").disabled).toBe(true);
  expect(host.querySelector<HTMLAnchorElement>(`a[href="/resources/${command.runId}"]`)?.target).toBe("_blank");
  expect(host.textContent).toContain("正式路径没有改变"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("shows a permanent existing child instead of enabling duplicate follow-up work", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceRunReview {...props({ initial: { ...discovered, childId: accountId, nextKind: null } })} />));
  expect(button("生成匹配建议")).toBeUndefined(); expect(host.querySelector(`a[href="/resources/${accountId}"]`)?.textContent).toBe("查看已有后续运行");
  expect(host.textContent).toContain("包括已取消或中断"); expect(fetcher).not.toHaveBeenCalled();
});
it("keeps stale and failed evidence visibly historical, with no inferred successful recommendation", async () => {
  await act(async () => root.render(<ResourceRunReview {...props({ initial: { ...discovered, status: "stale", nextKind: null } })} />));
  expect(host.textContent).toContain("历史版本的材料与建议"); expect(button("生成匹配建议")).toBeUndefined();
  await act(async () => root.render(<ResourceRunReview {...props({ initial: { ...discovered, id: accountId, status: "failed", nextKind: null, result: { ...discovered.result!, status: "unavailable" } } })} />));
  expect(host.textContent).toContain("不是本次成功推荐"); expect(host.textContent).toContain("不代表字幕已重新核对");
});
it("renders untrusted metadata, reasoning and quotations as plain text with canonical YouTube links only", async () => {
  const result: ResourceRunView = { ...discovered, kind: "match", nextKind: null, result: { ...discovered.result!, status: "matched", summary: "<script>private()</script>",
    candidates: [{ ...candidate, assessment: { role: "recommended", relevance: "[go](javascript:bad)", levelFit: "入门", languageFit: "中文", timeFit: "5 分钟", freshness: "基础概念",
      limitations: ["<iframe>unsafe</iframe>"], evidence: [{ quote: "<a href='javascript:bad'>原文</a>", offsetMs: 61500 }], totalSegments: 100, sampledSegments: 24, textTruncated: true } }] } };
  await act(async () => root.render(<ResourceRunReview {...props({ initial: result })} />));
  expect(host.querySelector("script,img,iframe")).toBeNull(); expect(host.textContent).toContain("<script>private()</script>");
  expect(host.querySelector('a[href="https://www.youtube.com/watch?v=abcdefghijk&t=61s"]')).not.toBeNull();
  expect([...host.querySelectorAll("a")].every(link => !link.href.includes("javascript:") && !link.href.includes("untrusted.example"))).toBe(true);
  expect(host.textContent).toContain("抽样 24 / 100 段字幕");
});
it("hides all private node context and history after a POST authentication rejection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code: "forbidden" }, { status: 403 })));
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled />));
  await enter("观看地区代码", "US"); await act(async () => button("查找视频").click());
  expect(host.textContent).toContain("私人内容与历史记录已隐藏"); expect(host.textContent).not.toContain("PRIVATE_");
  expect(host.querySelector(`a[href="/resources/${runId}"]`)).toBeNull();
});
it("hides private review content on identity loss and does not restore it from a late action response", async () => {
  const reading = deferred<Awaited<ReturnType<ResourceRunReviewProps["readAction"]>>>();
  const options = props({ initial: discovered, readAction: () => reading.promise, cancelAction: async () => ({ ok: false, code: "forbidden" }) });
  await act(async () => root.render(<ResourceRunReview {...options} />));
  await act(async () => button("读取最新状态").click());
  await act(async () => root.render(<ResourceRunReview {...options} accountId={nodeId} />));
  expect(host.textContent).not.toContain("PRIVATE_");
  await act(async () => reading.resolve({ ok: true, value: discovered }));
  expect(host.textContent).not.toContain("PRIVATE_"); expect(host.textContent).toContain("身份已变化");
});
it("failed read blocks a new phase until explicit successful reconciliation", async () => {
  const readAction = vi.fn<ResourceRunReviewProps["readAction"]>().mockResolvedValueOnce({ ok: false, code: "unavailable" }).mockResolvedValueOnce({ ok: true, value: discovered });
  await act(async () => root.render(<ResourceRunReview {...props({ initial: discovered, readAction })} />));
  await act(async () => button("读取最新状态").click()); expect(button("生成匹配建议").disabled).toBe(true); expect(host.textContent).toContain("上次保存的内容");
  await act(async () => button("读取最新状态").click()); expect(button("生成匹配建议").disabled).toBe(false);
});
it("uses page-number history links and routes back to the exact formal Path Node", async () => {
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={{ ...node, offset: 20, hasMore: true }} enabled={false} />));
  expect(host.querySelector(`a[href="/resources/nodes/${nodeId}?page=1"]`)?.textContent).toBe("上一页");
  expect(host.querySelector(`a[href="/resources/nodes/${nodeId}?page=3"]`)?.textContent).toBe("下一页");
  expect(host.querySelector(`a[href="/paths/${node.goalId}?node=${nodeId}"]`)).not.toBeNull();
});
it("enforces the provider duration ceiling and makes blank duration an explicit 24 hour cap", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: false, code: "quota_exhausted" }, { status: 409 })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled />));
  await enter("观看地区代码", "CN"); await enter("单个视频时长上限（分钟）", "1441"); expect(button("查找视频").disabled).toBe(true);
  await enter("单个视频时长上限（分钟）", ""); expect(host.textContent).toContain("时长留空按 24 小时上限");
  await act(async () => button("查找视频").click()); expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).preferences.maxDurationSeconds).toBe(86400);
  expect(host.textContent).toContain("本类操作次数不足"); expect(button("查找视频").disabled).toBe(true);
});
it("does not let a later read supersede an unresolved cancellation", async () => {
  const cancelling = deferred<Awaited<ReturnType<ResourceRunReviewProps["cancelAction"]>>>(), readAction = vi.fn(async () => ({ ok: true as const, value: run }));
  await act(async () => root.render(<ResourceRunReview {...props({ readAction, cancelAction: () => cancelling.promise })} />));
  await act(async () => button("取消本次运行").click());
  expect(button("读取最新状态").disabled).toBe(true);
  await act(async () => button("读取最新状态").click()); expect(readAction).not.toHaveBeenCalled();
  await act(async () => cancelling.resolve({ ok: true, value: { ...run, status: "cancelled" } }));
  expect(host.textContent).toContain("已取消"); expect(button("读取最新状态").disabled).toBe(false);
});
it("offers readable language choices and submits the canonical English code", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: false, code: "quota_exhausted" }, { status: 409 })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled />));
  const language = host.querySelector<HTMLSelectElement>('select[aria-label="字幕语言"]');
  expect(language?.selectedOptions[0].textContent).toBe("中文");
  await enter("观看地区代码", "US"); await selectLanguage("en");
  expect(host.querySelector('[aria-label="其他字幕语言代码"]')).toBeNull();
  await act(async () => button("查找视频").click());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).preferences.language).toBe("en");
});
it("keeps other languages available through an explicit advanced code field", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: false, code: "quota_exhausted" }, { status: 409 })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ResourceNodeWorkbench accountId={accountId} initial={node} enabled />));
  await enter("观看地区代码", "US"); await selectLanguage("other");
  expect(button("查找视频").disabled).toBe(true);
  await enter("其他字幕语言代码", "invalid language"); expect(button("查找视频").disabled).toBe(true);
  await enter("其他字幕语言代码", "pt-BR"); expect(button("查找视频").disabled).toBe(false);
  await act(async () => button("查找视频").click());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).preferences.language).toBe("pt-BR");
});
