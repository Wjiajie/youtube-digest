// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanningApproval } from "./planning-approval";
import type { PlanningApprovalRecord } from "@/lib/agent/planning-approval";

const id = "10000000-0000-4000-8000-000000000001";
const initial: PlanningApprovalRecord = { runId: id, ownerId: id, sourceCurrent: true, proposal: null };
const pending: PlanningApprovalRecord = { ...initial, proposal: { id, baseVersion: 0, status: "pending", appliedVersion: null,
  draft: { schemaVersion: 2, id, version: 0, title: "我的蓝图", goals: [] } } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(el => el.textContent === text)!;
it("requires separate prepare and confirmation gestures before changing the formal path", async () => {
  const prepare = vi.fn(async () => ({ ok: true as const, value: pending }));
  const apply = vi.fn(async () => ({ ok: true as const, value: { ...pending, proposal: { ...pending.proposal!, status: "applied" as const, appliedVersion: 1 } } }));
  await act(async () => root.render(<PlanningApproval accountId={id} runId={id} runStatus="ready" initial={{ ok: true, value: initial }}
    actions={{ read: async () => ({ ok: true, value: initial }), prepare, apply, reject: async () => ({ ok: true, value: pending }) }} />));
  expect(apply).not.toHaveBeenCalled(); expect(button("确认并应用")).toBeUndefined();
  await act(async () => button("准备确认提案").click());
  expect(prepare).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
  await act(async () => button("确认并应用").click());
  expect(apply).toHaveBeenCalledWith(id, 0);
  expect(host.textContent).toContain("已写入正式蓝图 v1");
});
it("requires reading back after an uncertain confirmation and never repeats it automatically", async () => {
  const apply = vi.fn(async () => { throw new Error("response lost"); });
  const read = vi.fn(async () => ({ ok: true as const, value: { ...pending, proposal: { ...pending.proposal!, status: "applied" as const, appliedVersion: 1 } } }));
  await act(async () => root.render(<PlanningApproval accountId={id} runId={id} runStatus="ready" initial={{ ok: true, value: pending }}
    actions={{ read, apply, prepare: read, reject: read }} />));
  await act(async () => button("确认并应用").click());
  expect(button("确认并应用")?.disabled).toBe(true); expect(apply).toHaveBeenCalledTimes(1);
  await act(async () => button("核对提案状态").click());
  expect(apply).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("已写入正式蓝图 v1");
});
it("blocks stale proposals and hides a response from another identity", async () => {
  await act(async () => root.render(<PlanningApproval accountId={id} runId={id} runStatus="stale" initial={{ ok: true, value: pending }}
    actions={{ read: async () => ({ ok: false, code: "forbidden" }), apply: async () => ({ ok: false, code: "unavailable" }),
      prepare: async () => ({ ok: false, code: "unavailable" }), reject: async () => ({ ok: false, code: "unavailable" }) }} />));
  expect(button("确认并应用").disabled).toBe(true);
  await act(async () => button("核对提案状态").click());
  expect(host.textContent).toContain("身份无法访问"); expect(button("确认并应用")).toBeUndefined();
});
