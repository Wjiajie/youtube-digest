// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClarificationWorkbench } from "./clarification-workbench";
import type { ClarificationWorkbenchProps, ClarificationSnapshot, ClarificationTurnView } from "./clarification-view";

const accountId = "10000000-0000-4000-8000-000000000001", sessionId = "10000000-0000-4000-8000-000000000002", briefId = "10000000-0000-4000-8000-000000000003";
const initial: ClarificationSnapshot = { session: { id: sessionId, briefId, sourceRevision: 1, revision: 1,
  updatedAt: "2026-09-10T00:00:00Z", status: "active", mode: "needs_input", question: "你希望实现什么目标？",
  content: { schemaVersion: 1, outcome: "PRIVATE_PHOTOGRAPHY", startingPoint: "", targetDate: null, weeklyMinutes: null, constraints: "", successCriteria: "" } },
  turns: [], offset: 0, hasMore: false };
function props(overrides: Partial<ClarificationWorkbenchProps> = {}): ClarificationWorkbenchProps {
  return { accountId, initial, enabled: true, pendingTurnId: null,
    readAction: async () => ({ ok: true, value: initial }),
    readTurnAction: async () => ({ ok: false, code: "not_found" }),
    cancelAction: async () => ({ ok: false, code: "unavailable" }),
    editAction: async () => ({ ok: false, code: "unavailable" }),
    saveAction: async () => ({ ok: false, code: "unavailable" }), ...overrides };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (name: string) => [...host.querySelectorAll("button")].find(el => el.textContent === name)!;
const input = (name: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`)!;
async function enter(name: string, value: string) {
  await act(async () => {
    const element = input(name);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function turn(id: string, status: ClarificationTurnView["status"]): ClarificationTurnView {
  return { id, ordinal: 1, createdAt: "2026-09-10T00:00:00Z", status, question: "你希望实现什么目标？", answer: "我想改善构图", skillVersion: null, suggestion: null };
}

it("shows a deliberate conversation, editable summary and honest readiness with generation disabled", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ClarificationWorkbench {...props({ enabled: false })} />));
  expect(host.textContent).toContain("你希望实现什么目标？");
  expect(host.textContent).toContain("工作摘要");
  expect(host.textContent).toContain("完整度不等于目标质量");
  expect(host.textContent).toContain("Agent 暂未启用");
  expect(input("我希望实现").value).toBe("PRIVATE_PHOTOGRAPHY");
  expect(button("发送回答").disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it("releases an unstarted turn when the server has disabled generation after the page loaded", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: false, code: "disabled" }, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ClarificationWorkbench {...props()} />));
  await enter("你的回答", "我想改善构图");
  await act(async () => button("发送回答").click());
  expect(host.textContent).toContain("Agent 暂未启用");
  expect(button("取消本轮")).toBeUndefined();
  expect(new URL(window.location.href).searchParams.get("turn")).toBeNull();
  expect(input("你的回答").value).toBe("我想改善构图");
  expect(input("我的起点").readOnly).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("captures one HTTP command, retains the answer until acknowledgement and cancels independently of a stalled POST", async () => {
  const network = deferred<Response>();
  const fetcher = vi.fn(() => network.promise); vi.stubGlobal("fetch", fetcher);
  const cancel = vi.fn(async (id: string) => ({ ok: true as const, value: turn(id, "cancelled") }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ cancelAction: cancel })} />));
  await enter("你的回答", "我想改善构图");
  await act(async () => button("发送回答").click());
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/clarification/turns");
  const command = JSON.parse(String(options.body));
  expect(command).toEqual({ accountId, sessionId, turnId: expect.any(String), expectedRevision: 1, message: "我想改善构图" });
  expect(new URL(window.location.href).searchParams.get("turn")).toBe(command.turnId);
  expect(input("你的回答").value).toBe("我想改善构图");
  expect(button("发送回答").disabled).toBe(true);
  expect(button("取消本轮").disabled).toBe(false);
  await act(async () => button("取消本轮").click());
  expect(cancel).toHaveBeenCalledWith(command.turnId);
  expect(host.textContent).toContain("已取消");
  expect([...host.querySelectorAll('[role="status"]')].some(el => el.textContent?.includes("已取消"))).toBe(true);
  await act(async () => network.resolve(Response.json({ ok: true, turnId: command.turnId, status: "running" })));
  expect(host.textContent).toContain("已取消");
  expect(button("取消本轮")).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires an explicit summary update before saving and replays an uncertain edit with the original mutation ID", async () => {
  let cloud = initial;
  const edit = vi.fn<ClarificationWorkbenchProps["editAction"]>()
    .mockResolvedValueOnce({ ok: false, code: "unavailable" })
    .mockImplementation(async command => {
      cloud = { ...cloud, session: { ...cloud.session, content: command.content, revision: 2 } };
      return { ok: true, value: cloud.session };
    });
  const save = vi.fn<ClarificationWorkbenchProps["saveAction"]>(async command => {
    cloud = { ...cloud, session: { ...cloud.session, revision: 3, status: "closed" } };
    return { ok: true, value: { session: cloud.session, briefId, confirmed: command.confirm } };
  });
  await act(async () => root.render(<ClarificationWorkbench {...props({ enabled: false, editAction: edit, saveAction: save, readAction: async () => ({ ok: true, value: cloud }) })} />));
  await enter("我的起点", "会使用相机"); await enter("每周可投入分钟", "180"); await enter("成功的依据", "六张作品");
  expect(button("保存草稿").disabled).toBe(true);
  await act(async () => button("更新工作摘要").click());
  expect(edit).toHaveBeenCalledTimes(1);
  expect(input("我的起点").readOnly).toBe(true);
  await act(async () => button("核对原提交结果").click());
  expect(edit).toHaveBeenCalledTimes(2);
  expect(edit.mock.calls[1][0]).toEqual(edit.mock.calls[0][0]);
  expect(button("确认这版目标定义").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => button("确认这版目标定义").click());
  expect(save).toHaveBeenCalledWith({ expectedRevision: 2, confirm: true, clientMutationId: expect.any(String) });
  expect(save.mock.calls[0][0].clientMutationId).not.toBe(edit.mock.calls[0][0].clientMutationId);
  expect(host.textContent).toContain("本次保存已完成");
  expect(host.textContent).toContain("不会自动生成路径");
});
it("loads older conversation only on request and renders narrative without turning user quotes into links", async () => {
  const latest = { ...turn("20000000-0000-4000-8000-000000000002", "ready"), ordinal: 2, skillVersion: "1.0.0",
    suggestion: { mode: "paused" as const, reflection: "**先留住这个方向** [外链](https://example.test) ![图](https://example.test/a.png)",
      concerns: ["时间安排仍需核对"], changes: [{ field: "outcome" as const, value: "摄影", quote: "<img src=https://example.test/x> [原话](https://example.test)" }] } };
  const older = { ...turn("20000000-0000-4000-8000-000000000001", "cancelled"), answer: "第一轮的真实原文" };
  const read = vi.fn<ClarificationWorkbenchProps["readAction"]>(async offset => ({ ok: true, value: { ...initial, turns: [older], offset: offset ?? 0, hasMore: false } }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ initial: { ...initial, turns: [latest], hasMore: true }, readAction: read })} />));
  expect(read).not.toHaveBeenCalled();
  expect(host.querySelector("strong")?.textContent).toBe("先留住这个方向");
  expect(host.querySelector('a[href^="https:"]')).toBeNull(); expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("<img src=https://example.test/x>");
  await act(async () => button("加载更早记录").click());
  expect(read).toHaveBeenCalledWith(1);
  expect(host.textContent).toContain("第一轮的真实原文");
  expect(host.textContent).toContain("第 2 轮");
  expect(button("加载更早记录")).toBeUndefined();
});
it("does not resurrect a cancelled turn when a later snapshot contains its older running state", async () => {
  const running = turn("20000000-0000-4000-8000-000000000007", "running");
  const old = { ...initial, turns: [running] };
  await act(async () => root.render(<ClarificationWorkbench {...props({ initial: old, readAction: async () => ({ ok: true, value: old }),
    cancelAction: async id => ({ ok: true, value: turn(id, "cancelled") }) })} />));
  await act(async () => button("取消本轮").click());
  expect(button("取消本轮")).toBeUndefined();
  expect(host.textContent).toContain("已取消");
  expect(new URL(window.location.href).searchParams.get("turn")).toBeNull();
});
it("keeps an uncertain POST and not-yet-visible turn recoverable without clearing text or regenerating", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("offline"); }); vi.stubGlobal("fetch", fetcher);
  const readTurn = vi.fn<ClarificationWorkbenchProps["readTurnAction"]>(async () => ({ ok: false, code: "not_found" }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ readTurnAction: readTurn })} />));
  await enter("你的回答", "尚未被确认的私人原文");
  await act(async () => button("发送回答").click());
  const id = new URL(window.location.href).searchParams.get("turn");
  await act(async () => button("刷新云端记录").click());
  expect(readTurn).toHaveBeenCalledWith(id);
  expect(input("你的回答").value).toBe("尚未被确认的私人原文");
  expect(button("发送回答").disabled).toBe(true); expect(button("取消本轮").disabled).toBe(false);
  expect(host.textContent).toContain("不能据此断定");
  expect(host.querySelector('[role="status"]')!.textContent).not.toContain("正在核对");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("recovers the exact URL turn on mount by reading only, even when inference is disabled", async () => {
  const id = "20000000-0000-4000-8000-000000000008";
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  const readTurn = vi.fn<ClarificationWorkbenchProps["readTurnAction"]>(async turnId => ({ ok: true, value: turn(turnId, "cancelled") }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ enabled: false, pendingTurnId: id, readTurnAction: readTurn })} />));
  expect(readTurn).toHaveBeenCalledWith(id); expect(fetcher).not.toHaveBeenCalled();
  expect(host.textContent).toContain("已取消"); expect(button("取消本轮")).toBeUndefined();
});
it("preserves dirty editor fields across refresh and requires an explicit revision choice", async () => {
  const latest = { ...initial, session: { ...initial.session, revision: 2, content: { ...initial.session.content, startingPoint: "另一标签页的起点" } } };
  const edit = vi.fn<ClarificationWorkbenchProps["editAction"]>(async () => ({ ok: false, code: "unavailable" }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ readAction: async () => ({ ok: true, value: latest }), editAction: edit })} />));
  await enter("我的起点", "我的未保存原文");
  await act(async () => button("刷新云端记录").click());
  expect(input("我的起点").value).toBe("我的未保存原文");
  expect(host.textContent).toContain("另一标签页的起点");
  expect(button("更新工作摘要").disabled).toBe(true);
  await act(async () => button("保留我的文字，以当前修订重新核对").click());
  await act(async () => button("更新工作摘要").click());
  expect(edit).toHaveBeenCalledWith({ expectedRevision: 2, content: expect.objectContaining({ startingPoint: "我的未保存原文" }), clientMutationId: expect.any(String) });
});
it("preserves private drafts on outage but hides all of them on identity loss and ignores late replies", async () => {
  let denied = false;
  const network = deferred<Response>(); const fetcher = vi.fn<typeof fetch>(() => network.promise); vi.stubGlobal("fetch", fetcher);
  const readTurn = vi.fn<ClarificationWorkbenchProps["readTurnAction"]>(async () => ({ ok: false, code: denied ? "forbidden" : "unavailable" }));
  await act(async () => root.render(<ClarificationWorkbench {...props({ readTurnAction: readTurn })} />));
  await enter("你的回答", "PRIVATE_ANSWER");
  await act(async () => button("发送回答").click());
  const id = new URL(window.location.href).searchParams.get("turn");
  await act(async () => button("刷新云端记录").click());
  expect(input("你的回答").value).toBe("PRIVATE_ANSWER");
  denied = true; await act(async () => button("刷新云端记录").click());
  expect(host.textContent).toContain("私人内容已隐藏"); expect(host.querySelector("textarea")).toBeNull();
  await act(async () => network.resolve(Response.json({ ok: true, turnId: id, status: "ready" })));
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("PRIVATE_");
});
it("does not carry any private projection or unfinished local fields across an account switch", async () => {
  const original = props();
  await act(async () => root.render(<ClarificationWorkbench {...original} />));
  await enter("我的起点", "PRIVATE_LOCAL_EDIT");
  await act(async () => root.render(<ClarificationWorkbench {...original} accountId={briefId} />));
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("PRIVATE_"); expect(host.textContent).toContain("重新登录");
});
it("keeps window-full answers and offers an explicit draft checkpoint without retrying the model", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: false, code: "window_full" }, { status: 409 })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<ClarificationWorkbench {...props()} />));
  await enter("你的回答", "这一轮原文先保留");
  await act(async () => button("发送回答").click());
  expect(input("你的回答").value).toBe("这一轮原文先保留");
  expect(host.textContent).toContain("13 轮成功记录");
  expect(button("发送回答").disabled).toBe(true);
  expect(button("保存草稿").disabled).toBe(false);
  expect(host.querySelector(`a[href="/goals/${briefId}/clarify"]`)).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("replays an uncertain save receipt with the same intent and checks current cloud state before unlocking", async () => {
  const commands: Parameters<ClarificationWorkbenchProps["saveAction"]>[0][] = [];
  const closed = { ...initial, session: { ...initial.session, status: "closed" as const, revision: 2 } };
  let count = 0;
  const save: ClarificationWorkbenchProps["saveAction"] = async command => {
    commands.push(command);
    return { ok: true, value: { session: closed.session, briefId, confirmed: false } };
  };
  await act(async () => root.render(<ClarificationWorkbench {...props({ saveAction: save,
    readAction: async () => ++count === 1 ? { ok: false, code: "unavailable" } : { ok: true, value: closed } })} />));
  await act(async () => button("保存草稿").click());
  expect(button("确认这版目标定义").disabled).toBe(true);
  await act(async () => button("核对原提交结果").click());
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]); expect(commands[0].confirm).toBe(false);
  expect(host.textContent).toContain("历史摘要不能代表当前目标定义的确认状态");
});
it("keeps new generation locked between a settled turn read and the current summary response", async () => {
  const id = "20000000-0000-4000-8000-000000000009";
  const cloud = deferred<Awaited<ReturnType<ClarificationWorkbenchProps["readAction"]>>>();
  await act(async () => root.render(<ClarificationWorkbench {...props({ pendingTurnId: id,
    readTurnAction: async turnId => ({ ok: true, value: turn(turnId, "ready") }), readAction: () => cloud.promise })} />));
  await enter("你的回答", "后续回答不能使用旧修订发送");
  expect(button("发送回答").disabled).toBe(true);
  expect(button("保存草稿").disabled).toBe(true);
  await act(async () => cloud.resolve({ ok: true, value: initial }));
  expect(button("发送回答").disabled).toBe(false);
});
