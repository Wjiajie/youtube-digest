// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ApplicationResult, GoalProgressView, ProgressEvidence } from "@blueprint/domain";
import { ThemeSurface } from "@blueprint/ui/theme";
import { HomeDashboard } from "./home-dashboard";

function goal(index: number): GoalProgressView {
  const node = { id: `node-${index}`, title: `下一步 ${index}`, type: "practice" as const, position: 0,
    dependencyIds: [], resources: [], estimatedMinutes: 30, completionCriteria: `完成依据 ${index}` };
  const stage = { id: `stage-${index}`, title: `当前阶段 ${index}`, position: 0, nodes: [node] };
  const next = { node, stageId: stage.id, stageTitle: stage.title, status: null, completion: "open" as const, blockedBy: [] };
  return { goal: { id: `goal-${index}`, title: `我的目标 ${index}`, position: index, stages: [stage] }, nodes: [next], next,
    confirmedCheckpoints: index, needsReviewCount: 0, awaitingPlan: false, allSelfConfirmed: false };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(goals: GoalProgressView[], theme: "cyberpunk" | "eastern" = "cyberpunk", evidence: ApplicationResult<ProgressEvidence[]> = { ok: true, value: [] }) {
  await act(async () => root.render(<ThemeSurface theme={theme}><HomeDashboard goals={goals} evidence={evidence} /></ThemeSurface>));
}

test("home limits goal modules to five and preserves a user-selected focus across themes without writing a preference", async () => {
  const goals = Array.from({ length: 6 }, (_, index) => goal(index));
  await render(goals);
  expect(host.querySelectorAll('button[aria-pressed]')).toHaveLength(5);
  expect(host.querySelector('[aria-label="当前重点"]')?.textContent).toContain("完成依据 0");
  const second = host.querySelector<HTMLButtonElement>('button[aria-label="关注目标：我的目标 1"]')!;
  await act(async () => { second.focus(); second.click(); }); await render(goals, "eastern");
  expect(second.isConnected).toBe(true); expect(second.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(second);
  const focus = host.querySelector('[aria-label="当前重点"]')!;
  expect(focus.textContent).toContain("完成依据 1"); expect(focus.textContent).toContain("当前阶段 1");
  expect(focus.querySelector("a")?.getAttribute("href")).toBe("/paths/goal-1?node=node-1");
  expect(host.querySelector('a[href="/paths"]')?.textContent).toContain("完整目标列表");
  expect(localStorage.length).toBe(0);
});

test("review focus explains unsatisfied dependencies and never presents old confirmation as current mastery", async () => {
  const review = goal(0); review.next!.completion = "needs_review";
  review.next!.blockedBy = ["prerequisite"]; review.needsReviewCount = 1;
  review.nodes.push({ ...review.next!, node: { ...review.next!.node, id: "prerequisite", title: "先练习开场" }, completion: "open", blockedBy: [] });
  await render([review]);
  const focus = host.querySelector('[aria-label="当前重点"]')!;
  expect(focus.textContent).toContain("待复核"); expect(focus.textContent).toContain("先练习开场");
  expect(focus.textContent).toContain("不是绕过前置条件的建议");
  expect(focus.textContent).toContain("旧确认不代表当前依据已满足");
});

test("empty home guides goal definition without inventing a path, and empty or fully self-confirmed paths have distinct honest states", async () => {
  await render([]);
  expect(host.textContent).toContain("还没有正式目标"); expect(host.querySelector('a[href="/goals/new"]')).not.toBeNull();
  const empty = goal(0); empty.nodes = []; empty.next = null; empty.awaitingPlan = true;
  await render([empty]);
  expect(host.textContent).toContain("等待规划"); expect(host.querySelector('a[href="/blueprint/edit"]')).not.toBeNull();
  const complete = goal(0); complete.next = null; complete.allSelfConfirmed = true;
  await render([complete]);
  const focus = host.querySelector('[aria-label="当前重点"]')!;
  expect(focus.textContent).toContain("所有节点已由你自确认");
  expect(focus.textContent).toContain("不等于目标达成或能力认证");
  expect(focus.querySelector('a[href="/paths/goal-0"]')).not.toBeNull();
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

test("recent evidence keeps historical names, links only nodes still in their original current goal, and shows at most three", async () => {
  const records: ProgressEvidence[] = Array.from({ length: 4 }, (_, index) => ({ id: `evidence-${index}`, clientMutationId: `mutation-${index}`,
    context: { blueprintId: "blueprint", blueprintVersion: 3, goalId: index === 1 ? "archived-goal" : "goal-0", goalTitle: "当时的目标",
      stageId: "old-stage", stageTitle: "当时的阶段", nodeId: "node-0", nodeTitle: "当时的节点名称", nodeType: "practice" },
    text: `真实收获 ${index}`, artifactUrl: null, createdAt: `2026-09-10T00:00:0${3 - index}Z` }));
  await render([goal(0)], "cyberpunk", { ok: true, value: records });
  const articles = host.querySelectorAll('[aria-label="最近成果"] article'); expect(articles).toHaveLength(3);
  expect(articles[0]?.textContent).toContain("当时的节点名称"); expect(articles[0]?.textContent).toContain("路径版本 3");
  expect(articles[0]?.querySelector('a[href="/paths/goal-0?node=node-0"]')).not.toBeNull();
  expect(articles[1]?.textContent).toContain("历史记录"); expect(articles[1]?.querySelector('a[href^="/paths/"]')).toBeNull();
  expect(host.textContent).not.toContain("真实收获 3");
});

test("failed evidence reads are not rendered as empty accomplishments", async () => {
  await render([goal(0)], "eastern", { ok: false, code: "unavailable" });
  const recent = host.querySelector('[aria-label="最近成果"]')!;
  expect(recent.textContent).toContain("暂时无法读取成果"); expect(recent.textContent).not.toContain("还没有成果记录");
  expect(host.querySelector('[aria-label="当前重点"]')?.textContent).toContain("完成依据 0");
  await render([goal(0)], "eastern", { ok: true, value: [] });
  expect(recent.textContent).toContain("还没有成果记录");
});

test("removed focus falls back to an available goal and no eligible next node explains the path dependency state", async () => {
  const goals = [goal(0), goal(1)]; await render(goals);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关注目标：我的目标 1"]')!.click());
  const remaining = goal(0); remaining.next = null;
  await render([remaining]);
  const focus = host.querySelector('[aria-label="当前重点"]')!;
  expect(focus.textContent).toContain("我的目标 0"); expect(focus.textContent).toContain("当前没有前置条件已满足的下一步");
  expect(host.querySelector('[aria-label="个人身份静态回退"]')?.textContent).toContain("二维回退");
});
