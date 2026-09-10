// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanningReview } from "./planning-review";
import { parsePlanningRun } from "@/lib/agent/planning-run";

const owner = "10000000-0000-4000-8000-000000000001", id = "10000000-0000-4000-8000-000000000002";
function queued() {
  return parsePlanningRun({ id, owner_id: owner, brief_id: id, blueprint_id: owner, brief_revision: 1, blueprint_version: 0,
    start_date: "2026-09-10", status: "queued", skill: null, result: null,
    created_at: "2026-09-10T00:00:00Z", expires_at: "2026-09-10T00:02:00Z",
    input_blueprint: { schemaVersion: 2, id: owner, version: 0, title: "蓝图", goals: [] },
    input_brief: { id, blueprintId: owner, revision: 1, status: "confirmed", updatedAt: "2026-09-10T00:00:00Z",
      content: { schemaVersion: 1, outcome: "PRIVATE_PHOTOGRAPHY", startingPoint: "会使用相机", targetDate: null,
        weeklyMinutes: 180, constraints: "周末", successCriteria: "六张作品" } } }, owner, id);
}
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(el => el.textContent === text)!;

it("cancels pending work without generating or applying a path", async () => {
  const initial = queued(); const cancel = vi.fn(async () => ({ ok: true as const, run: { ...initial, status: "cancelled" as const,
    result: { status: "cancelled" as const, providerMayHaveRun: false, usage: null } } }));
  await act(async () => root.render(<PlanningReview accountId={owner} initial={initial} readAction={async () => ({ ok: true, run: initial })} cancelAction={cancel} />));
  expect(host.textContent).toContain("等待执行");
  await act(async () => button("取消本次规划").click());
  expect(cancel).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("已取消");
  expect(button("取消本次规划")).toBeUndefined();
  expect(host.textContent).not.toContain("已应用路径");
});

it("keeps recoverable content on network failure but hides it when identity is lost", async () => {
  let denied = false; const initial = queued();
  await act(async () => root.render(<PlanningReview accountId={owner} initial={initial}
    readAction={async () => ({ ok: false, code: denied ? "unauthenticated" : "unavailable" })}
    cancelAction={async () => ({ ok: false, code: "unavailable" })} />));
  await act(async () => button("刷新运行状态").click());
  expect(host.textContent).toContain("PRIVATE_PHOTOGRAPHY"); expect(host.textContent).toContain("不是最新状态");
  denied = true; await act(async () => button("刷新运行状态").click());
  expect(host.textContent).not.toContain("PRIVATE_PHOTOGRAPHY"); expect(host.textContent).toContain("重新登录");
});

it("does not carry private data across an account change", async () => {
  const props = { initial: queued(), readAction: async () => ({ ok: false as const, code: "unavailable" as const }),
    cancelAction: async () => ({ ok: false as const, code: "unavailable" as const }) };
  await act(async () => root.render(<PlanningReview accountId={owner} {...props} />));
  await act(async () => root.render(<PlanningReview accountId={id} {...props} />));
  expect(host.textContent).not.toContain("PRIVATE_PHOTOGRAPHY");
});
