// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { projectBlueprintProgress, type GoalProgressView } from "@blueprint/domain";
import { PathsOverview, GoalPathView } from "../src/app/paths/path-views";

function emptyGoal(id = "goal-1", title = "练习公开表达"): GoalProgressView {
  return { goal: { id, title, position: 0, stages: [] }, nodes: [], next: null,
    confirmedCheckpoints: 0, needsReviewCount: 0, awaitingPlan: true, allSelfConfirmed: false };
}
function render(element: React.ReactNode) {
  const host = document.createElement("div"); host.innerHTML = renderToStaticMarkup(element); return host;
}

function fullGoal(): GoalProgressView {
  const view = emptyGoal();
  const types = ["learn", "practice", "checkpoint", "reflection"] as const;
  const titles = ["理解演讲结构", "录制第一版", "邀请听众反馈", "回看并复盘"];
  const nodes = types.map((type, index) => ({ id: `node-${index}`, type, title: titles[index]!, position: index,
    description: index === 0 ? "先弄清开场与结尾的作用。" : undefined,
    estimatedMinutes: index === 0 ? 30 : null, completionCriteria: index === 0 ? "解释开场与结尾\n给出自己的例子" : "",
    dependencyIds: index ? [`node-${index - 1}`] : [], resources: [] }));
  view.goal.stages = [{ id: "stage-empty", title: "后续计划", position: 2, nodes: [] },
    { id: "stage-main", title: "表达练习", position: 0, nodes }];
  // The component consumes the ordered domain view, not an independently sorted plan.
  return projectBlueprintProgress({ schemaVersion: 2, id: "blueprint", title: "蓝图", version: 1, goals: [view.goal] }, [])[0]!;
}

test("all formal goals remain reachable beyond the home focus limit and empty paths do not invent action", () => {
  const goals = Array.from({ length: 7 }, (_, index) => emptyGoal(`goal-${index}`, `正式目标 ${index + 1}`));
  const host = render(<PathsOverview goals={goals} />);
  expect(host.querySelectorAll('a[href^="/paths/"]')).toHaveLength(7);
  expect(host.textContent).toContain("正式目标 7");
  expect(host.textContent).toContain("等待规划");
  expect(host.textContent).not.toContain("100%");
  expect(host.querySelector('a[href="/blueprint/edit"]')).not.toBeNull();
});

test("the full path retains all four resource-free node kinds, ordered stages and named prerequisites", () => {
  const host = render(<GoalPathView goal={fullGoal()} selectedNodeId="node-2" />);
  expect([...host.querySelectorAll('[aria-label="路径阶段"] > li > section > h2')].map(item => item.textContent)).toEqual(["表达练习", "后续计划"]);
  for (const text of ["学习", "实践", "检查点", "复盘", "30 分钟", "投入待明确", "完成依据待明确", "这个阶段还没有节点", "先弄清开场与结尾的作用。", "给出自己的例子"]) expect(host.textContent).toContain(text);
  expect(host.querySelectorAll('[aria-label="完整节点路径"] article')).toHaveLength(4);
  expect(host.querySelector('#node-node-2')?.getAttribute("aria-current")).toBe("location");
  expect(host.querySelector('#node-node-2 a[href="#node-node-1"]')?.textContent).toContain("录制第一版");
  expect(host.textContent).toContain("前置节点尚待自我确认");
  expect(host.querySelector('a[href="/progress/status"]')?.textContent).toContain("确认节点状态");
  expect(host.querySelector('a[href="/progress"]')?.textContent).toContain("记录成果");
  expect(host.textContent).toContain("进入后选择对应节点");
});

test("resource links open only canonical matching YouTube bindings and an invalid selection preserves the full path", () => {
  const goal = fullGoal();
  goal.nodes[0]!.node.resources = [
    { id: "video-1", kind: "youtube_video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", externalId: "dQw4w9WgXcQ" },
    { id: "video-2", kind: "youtube_video", url: "javascript:alert(1)", externalId: "dQw4w9WgXcQ" },
    { id: "video-3", kind: "youtube_video", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", externalId: "dQw4w9WgXcQ" },
  ];
  const host = render(<GoalPathView goal={goal} selectedNodeId="missing-node" />);
  const external = host.querySelectorAll('a[target="_blank"]');
  expect(external).toHaveLength(1);
  expect(external[0]?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(external[0]?.getAttribute("rel")).toContain("noopener");
  expect(host.textContent).toContain("资源链接暂不可用");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("指定节点不在当前路径中");
  expect(host.querySelectorAll('[aria-label="完整节点路径"] article')).toHaveLength(4);
});

test("both themes distinguish a review from effective self-confirmation without percentage or automatic completion", () => {
  const goal = fullGoal(); goal.nodes[0]!.completion = "needs_review"; goal.needsReviewCount = 1;
  goal.nodes[2]!.completion = "self_confirmed"; goal.confirmedCheckpoints = 1;
  const before = structuredClone(goal);
  const cyber = render(<div data-bp-theme="cyberpunk"><GoalPathView goal={goal} /></div>);
  const eastern = render(<div data-bp-theme="eastern"><GoalPathView goal={goal} /></div>);
  expect(cyber.textContent).toBe(eastern.textContent);
  expect(cyber.textContent).toContain("旧自评待复核");
  expect(cyber.textContent).toContain("1 个检查点已自我确认");
  expect(cyber.querySelectorAll("form, input, button")).toHaveLength(0);
  expect(goal).toEqual(before);
  goal.next = null; goal.allSelfConfirmed = true; goal.needsReviewCount = 0;
  const completed = render(<PathsOverview goals={[goal]} />);
  expect(completed.textContent).toContain("全部节点已自我确认");
  expect(completed.textContent).toContain("不代表目标已经达成");
  expect(completed.textContent).not.toContain("100%");
});
