// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanningStart } from "./planning-start";

const accountId = "10000000-0000-4000-8000-000000000001";
const briefId = "10000000-0000-4000-8000-000000000002";
const runId = "10000000-0000-4000-8000-000000000003";
const props = { accountId, briefId, briefRevision: 2, blueprintVersion: 3, confirmed: true, enabled: true };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => runId) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

it("locks duplicate gestures while waiting and provides recovery for a queued response", async () => {
  let respond!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PlanningStart {...props} />));
  await act(async () => { generate().click(); generate().click(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(generate().disabled).toBe(true);
  expect(host.querySelector(`a[href="/planning/${runId}"]`)?.textContent).toBe("查看本次规划");
  expect(host.querySelector(`a[href="/planning/${runId}"]`)?.getAttribute("target")).toBe("_blank");
  expect(host.querySelector(`a[href="/planning/${runId}"]`)?.getAttribute("rel")).toContain("noopener");
  expect(host.textContent).toContain("记录可能尚未创建");
  await act(async () => respond(Response.json({ ok: true, runId, status: "queued" })));
  expect(host.textContent).toContain("等待执行");
  expect(host.querySelector(`a[href="/planning/${runId}"]`)).not.toBeNull();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const generate = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

it("does not notify the current page about a late authorization failure from the previous account", async () => {
  let respond!: (response: Response) => void;
  const onIdentityLost = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
  await act(async () => root.render(<PlanningStart {...props} onIdentityLost={onIdentityLost} />));
  await act(async () => generate().click());
  await act(async () => root.render(<PlanningStart {...props} accountId={briefId} onIdentityLost={onIdentityLost} />));
  await act(async () => respond(Response.json({ ok: false, code: "forbidden" }, { status: 403 })));
  expect(onIdentityLost).not.toHaveBeenCalled();
  expect(generate().disabled).toBe(false);
});

it("uses an explicitly edited date without generating until submission", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, runId, status: "running" })); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PlanningStart {...props} />));
  const date = host.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "2026-09-11");
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => generate().click());
  expect(fetch).toHaveBeenCalledWith("/api/planning/runs", expect.objectContaining({ body: JSON.stringify({ accountId, runId, briefId, expectedBriefRevision: 2, expectedBlueprintVersion: 3, startDate: "2026-09-11" }) }));
  expect(host.textContent).toContain("正在生成");
});

it.each([
  ["input_too_large", "未调用模型，预留次数已退回"],
  ["quota_exhausted", "规划次数不足"], ["busy", "已有正在处理的规划"],
  ["disabled", "生成服务暂未开放"], ["version_conflict", "目标定义或蓝图已变化"],
  ["invalid", "请核对目标定义与开始日期"], ["not_found", "没有找到可访问的目标定义"],
  ["cancelled", "请求已取消"], ["unavailable", "状态尚未确认"],
])("explains a %s server outcome without fabricating a successful generation", async (code, copy) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code }, { status: 409 })));
  await act(async () => root.render(<PlanningStart {...props} />));
  await act(async () => generate().click());
  expect(host.textContent).toContain(copy);
  expect(host.textContent).not.toContain("建议已生成");
});

it.each(["account", "brief"])("discards a late old response when the %s session changes", async change => {
  let respond!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
  await act(async () => root.render(<PlanningStart {...props} />));
  await act(async () => generate().click());
  await act(async () => root.render(<PlanningStart {...props} accountId={change === "account" ? briefId : accountId} briefId={change === "brief" ? accountId : briefId} />));
  await act(async () => respond(Response.json({ ok: true, runId, status: "ready" })));
  expect(host.querySelector(`a[href="/planning/${runId}"]`)).toBeNull();
  expect(generate().disabled).toBe(false);
});

it.each(["unauthenticated", "forbidden"])("hides actions and private recovery links after %s", async code => {
  const onIdentityLost = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code })));
  await act(async () => root.render(<PlanningStart {...props} onIdentityLost={onIdentityLost} />));
  await act(async () => generate().click());
  expect(host.textContent).toContain("身份无法访问");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector(`a[href="/planning/${runId}"]`)).toBeNull();
  expect(onIdentityLost).toHaveBeenCalledTimes(1);
});

it.each(["unconfirmed", "disabled"])("does not submit when %s", async reason => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PlanningStart {...props} confirmed={reason !== "unconfirmed"} enabled={reason !== "disabled"} />));
  expect(generate().disabled).toBe(true);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain(reason === "disabled" ? "生成服务暂未开放" : "请先确认目标定义");
});

it.each(["throw", "wrong-run", "malformed"])("keeps an unresolved %s outcome locked and offers only the original run's recovery link", async failure => {
  const fetch = vi.fn(async () => {
    if (failure === "throw") throw new Error("response lost");
    return Response.json(failure === "wrong-run" ? { ok: true, runId: briefId, status: "ready" } : { ok: true, runId, status: "imaginary" });
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PlanningStart {...props} />));
  await act(async () => generate().click());
  expect(host.textContent).toContain("状态尚未确认");
  expect(generate().disabled).toBe(true);
  await act(async () => generate().click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(host.querySelector(`a[href="/planning/${runId}"]`)).not.toBeNull();
  expect(host.querySelector(`a[href="/planning/${briefId}"]`)).toBeNull();
  expect(host.querySelector(`a[href="/goals/${briefId}/planning"]`)).not.toBeNull();
});

it("waits for an explicit gesture, sends the visible date and source revisions, then links to review rather than applying", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, runId, status: "ready" }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<PlanningStart {...props} />));
  expect(fetch).not.toHaveBeenCalled();
  const date = host.querySelector<HTMLInputElement>('input[type="date"]')!;
  expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await act(async () => generate().click());
  expect(fetch).toHaveBeenCalledWith("/api/planning/runs", expect.objectContaining({
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, runId, briefId, expectedBriefRevision: 2, expectedBlueprintVersion: 3, startDate: date.value }),
  }));
  expect(host.querySelector<HTMLAnchorElement>(`a[href="/planning/${runId}"]`)?.textContent).toBe("查看本次规划");
  expect(host.textContent).toContain("请先审阅");
  expect(host.textContent).toContain("不会自动写入正式蓝图");
  expect(host.querySelector('a[href="/paths"]')).toBeNull();
});
