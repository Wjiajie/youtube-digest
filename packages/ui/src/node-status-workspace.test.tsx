// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { confirmNodeStatusSchema, type ApplicationResult, type NodeStatusRecord, type NodeStatusWorkspace } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { NodeStatusWorkspacePanel } from "./node-status-workspace";

const owner = "d7000000-0000-4000-8000-000000000001";
const nodeId = "d7000000-0000-4000-8000-000000000004";
const initial: NodeStatusWorkspace = {
  blueprint: { schemaVersion: 2, id: owner, version: 1, title: "我的路径", goals: [{
    id: "d7000000-0000-4000-8000-000000000002", title: "表达", position: 0, stages: [{
      id: "d7000000-0000-4000-8000-000000000003", title: "第一周", position: 0, nodes: [{
        id: nodeId, title: "独立演讲", type: "practice", position: 0, dependencyIds: [], resources: [],
        estimatedMinutes: 45, completionCriteria: "录制演讲并取得三条反馈",
      }],
    }],
  }] }, current: [], history: [], evidence: { ok: true, value: [] },
};
let host: HTMLDivElement, root: Root, workspace: NodeStatusWorkspace;
let save: (input: unknown) => Promise<ApplicationResult<NodeStatusRecord>>;
let read: () => Promise<ApplicationResult<NodeStatusWorkspace>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); workspace = structuredClone(initial);
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      await Promise.resolve(); if (held.has(key)) return callback(null);
      held.add(key); try { await callback({}); } finally { held.delete(key); }
    },
  } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save = async input => {
    const command = confirmNodeStatusSchema.parse(input);
    const record: NodeStatusRecord = { id: crypto.randomUUID(), clientMutationId: command.clientMutationId,
      context: { blueprintId: owner, blueprintVersion: command.expectedVersion, goalId: initial.blueprint.goals[0]!.id, goalTitle: "表达",
        stageId: initial.blueprint.goals[0]!.stages[0]!.id, stageTitle: "第一周", nodeId: command.nodeId, nodeTitle: "独立演讲", nodeType: "practice" },
      estimatedMinutes: 45, completionCriteria: "录制演讲并取得三条反馈", status: command.status,
      revision: command.expectedStatusRevision + 1, evidenceId: command.evidenceId ?? null, createdAt: "2026-09-10T00:00:00Z" };
    workspace = { ...workspace, current: [record], history: [record, ...workspace.history] };
    return { ok: true, value: record };
  };
  read = async () => ({ ok: true, value: workspace });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(navigator, "locks"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(accountId = owner, theme: "cyberpunk" | "eastern" = "cyberpunk") {
  await act(async () => root.render(<ThemeSurface theme={theme}><NodeStatusWorkspacePanel accountId={accountId}
    initial={workspace} saveAction={save} reloadAction={read} /></ThemeSurface>));
}
function button(label: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === label)!; }
async function choose(label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  expect(select).not.toBeNull();
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function selectNode() { await choose("路径节点", nodeId); }
async function acknowledge() { await act(async () => host.querySelector<HTMLInputElement>('[aria-label="我已核对完成依据，明确作出自我确认"]')!.click()); }

test("completion is an explicit self-assessment after visible criteria, never automatic mastery or invented history", async () => {
  await render(); await selectNode();
  expect(host.textContent).toContain("尚无状态确认历史");
  expect(host.textContent).toContain("录制演讲并取得三条反馈");
  expect(host.textContent).toContain("45 分钟");
  await choose("我的状态判断", "completed");
  expect(host.textContent).toContain("未关联成果");
  expect(button("确认节点状态").disabled).toBe(true);
  await acknowledge();
  await act(async () => button("确认节点状态").click());
  expect(workspace.current[0]?.status).toBe("completed");
  expect(host.textContent).toContain("状态确认已保存");
  expect(host.querySelectorAll(".node-status-history article")).toHaveLength(1);
  expect(initial.blueprint.version).toBe(1);
});

test("lost transport persists and restores the exact attempt, freezes editing, and retries only after an explicit click", async () => {
  const requests: unknown[] = []; const accept = save;
  save = async input => { requests.push(input); if (requests.length === 1) throw new Error("offline"); return accept(input); };
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  await act(async () => button("确认节点状态").click());
  expect(host.querySelector<HTMLSelectElement>('[aria-label="路径节点"]')!.disabled).toBe(true);
  expect(localStorage.getItem(`blueprint-node-status:v1:${owner}:${owner}`)).toContain("clientMutationId");
  await act(async () => root.unmount()); root = createRoot(host); await render(owner, "eastern");
  expect(requests).toHaveLength(1);
  await act(async () => button("确认原提交结果").click());
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(host.textContent).toContain("状态确认已保存");
});

test("another tab stays read-only and explicit takeover reads current state before editing", async () => {
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  const otherHost = document.createElement("div"); document.body.append(otherHost); const other = createRoot(otherHost);
  try {
    await act(async () => other.render(<StrictMode><NodeStatusWorkspacePanel accountId={owner} initial={initial} saveAction={save} reloadAction={read} /></StrictMode>));
    expect(otherHost.textContent).toContain("另一标签页");
    expect(otherHost.querySelector<HTMLSelectElement>('[aria-label="路径节点"]')!.disabled).toBe(true);
    await act(async () => root.unmount()); root = createRoot(host);
    workspace.blueprint.version = 2;
    await act(async () => [...otherHost.querySelectorAll("button")].find(item => item.textContent === "重新尝试编辑")!.click());
    expect(otherHost.textContent).toContain("当前版本 2");
    expect([...otherHost.querySelectorAll("button")].find(item => item.textContent === "确认节点状态")!.disabled).toBe(true);
  } finally { await act(async () => other.unmount()); otherHost.remove(); }
});

test("corrupt recovery remains copyable and unchanged until explicit reset", async () => {
  const key = `blueprint-node-status:v1:${owner}:${owner}`; localStorage.setItem(key, "{broken private draft");
  await render();
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原始恢复内容"]')?.value).toBe("{broken private draft");
  expect(localStorage.getItem(key)).toBe("{broken private draft");
  expect(button("确认节点状态").disabled).toBe(true);
  await act(async () => button("已另行保存原文，重置恢复信息").click());
  await selectNode(); await choose("我的状态判断", "in_progress");
  await act(async () => button("确认节点状态").click());
  expect(host.textContent).toContain("状态确认已保存");
});

test("a late original receipt is reconciled against newer current state, while its original criteria remain visible", async () => {
  const accept = save; let receipt: ApplicationResult<NodeStatusRecord>;
  save = async input => {
    receipt = await accept(input); if (!receipt.ok) return receipt;
    workspace.current = [{ ...receipt.value, id: crypto.randomUUID(), revision: 2, status: "not_started" }];
    throw new Error("lost response");
  };
  await render(); await selectNode(); await choose("我的状态判断", "completed"); await acknowledge();
  await act(async () => button("确认节点状态").click());
  workspace.blueprint = structuredClone(workspace.blueprint); workspace.blueprint.version = 2;
  workspace.blueprint.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "请两位听众评审";
  await act(async () => button("读取当前路径与状态").click());
  expect(host.querySelector(".node-status-pending")?.textContent).toContain("录制演讲并取得三条反馈");
  save = async () => receipt!; await render();
  await act(async () => button("确认原提交结果").click());
  expect(host.textContent).toContain("当前状态：尚未开始 · 修订 2");
  expect(host.textContent).toContain("完成依据已变化");
  expect(button("确认节点状态").disabled).toBe(true);
});

test("a receipt followed by stale read cannot announce current success or discard the recoverable attempt", async () => {
  read = async () => ({ ok: true, value: structuredClone(initial) });
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  await act(async () => button("确认节点状态").click());
  expect(host.textContent).not.toContain("状态确认已保存");
  expect(button("确认原提交结果").disabled).toBe(false);
});

test("storage rejection prevents an unrecorded send and preserves the editable choice", async () => {
  let sent = false; save = async () => { sent = true; return { ok: false, code: "unavailable" }; };
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await act(async () => button("确认节点状态").click());
  expect(sent).toBe(false); expect(host.textContent).toContain("尚未发送");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="我的状态判断"]')!.value).toBe("in_progress");
});

test("conflict preserves a choice but requires reading and explicit rebind before a new confirmation", async () => {
  const accept = save; save = async () => ({ ok: false, code: "version_conflict" });
  await render(); await selectNode(); await choose("我的状态判断", "completed"); await acknowledge();
  await act(async () => button("确认节点状态").click());
  expect(button("确认节点状态").disabled).toBe(true);
  workspace.blueprint = structuredClone(workspace.blueprint); workspace.blueprint.version = 2;
  workspace.blueprint.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "新的完成依据";
  await act(async () => button("读取当前路径与状态").click());
  await act(async () => button("按当前路径重新核对").click());
  expect(host.textContent).toContain("新的完成依据"); expect(button("确认节点状态").disabled).toBe(true);
  await acknowledge(); save = accept; await render();
  await act(async () => button("确认节点状态").click());
  expect(workspace.current[0]?.context.blueprintVersion).toBe(2);
});

test("identity failures hide private history and recovery without erasing the account's attempt", async () => {
  save = async () => ({ ok: false, code: "unauthenticated" });
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  await act(async () => button("确认节点状态").click());
  expect(host.textContent).toContain("账号或登录状态已变化"); expect(host.textContent).not.toContain("独立演讲");
  expect(localStorage.getItem(`blueprint-node-status:v1:${owner}:${owner}`)).toContain("clientMutationId");
});

test("without Web Locks only read operations are available", async () => {
  Reflect.deleteProperty(navigator, "locks"); await render();
  expect(host.textContent).toContain("仅可查看"); expect(button("确认节点状态").disabled).toBe(true);
  expect(button("读取当前路径与状态").disabled).toBe(false);
});

test("storage failure after an accepted receipt never says the request was not sent", async () => {
  const accept = save;
  save = async input => { const result = await accept(input);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota after save"); }); return result; };
  await render(); await selectNode(); await choose("我的状态判断", "in_progress");
  await act(async () => button("确认节点状态").click());
  expect(host.textContent).not.toContain("尚未发送");
  expect(button("确认原提交结果").disabled).toBe(false);
});

test("cancelled takeover releases its lock while a slow read remains pending and cannot overwrite a later owner", async () => {
  await render();
  const otherHost = document.createElement("div"); document.body.append(otherHost); const other = createRoot(otherHost);
  let finish!: (value: ApplicationResult<NodeStatusWorkspace>) => void; let reads = 0;
  const slowRead = () => { reads++; return new Promise<ApplicationResult<NodeStatusWorkspace>>(resolve => { finish = resolve; }); };
  try {
    await act(async () => other.render(<NodeStatusWorkspacePanel accountId={owner} initial={initial} saveAction={save} reloadAction={slowRead} />));
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => [...otherHost.querySelectorAll("button")].find(item => item.textContent === "重新尝试编辑")!.click());
    const manual = [...otherHost.querySelectorAll("button")].find(item => item.textContent === "读取当前路径与状态")!;
    expect(manual.disabled).toBe(true); await act(async () => manual.click()); expect(reads).toBe(1);
    await act(async () => other.unmount()); await render();
    expect(host.textContent).not.toContain("另一标签页");
    await selectNode();
    await act(async () => finish({ ok: false, code: "unauthenticated" }));
    expect(host.textContent).toContain("独立演讲"); expect(host.textContent).not.toContain("账号或登录状态已变化");
  } finally { await act(async () => other.unmount()); otherHost.remove(); }
});

test("all four resource-free node types allow completion with explicit criteria gaps and same-node optional evidence only", async () => {
  const source = workspace.blueprint.goals[0]!.stages[0]!.nodes[0]!;
  workspace.blueprint.goals[0]!.stages[0]!.nodes = (["learn", "practice", "checkpoint", "reflection"] as const).map((type, index) => ({
    ...source, id: index === 0 ? nodeId : crypto.randomUUID(), type, title: `${type} 节点`, completionCriteria: "", estimatedMinutes: null,
  }));
  const evidenceId = crypto.randomUUID();
  const context = { blueprintId: owner, blueprintVersion: 1, goalId: initial.blueprint.goals[0]!.id, goalTitle: "表达",
    stageId: initial.blueprint.goals[0]!.stages[0]!.id, stageTitle: "第一周", nodeId, nodeTitle: "学习", nodeType: "learn" as const };
  workspace.evidence = { ok: true, value: [{ id: evidenceId, clientMutationId: crypto.randomUUID(), context,
    text: "本节点的练习收获", artifactUrl: null, createdAt: "2026-09-10T00:00:00Z" },
  { id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(), context: { ...context, nodeId: crypto.randomUUID() },
    text: "不应关联的其他节点", artifactUrl: null, createdAt: "2026-09-10T00:00:00Z" }] };
  await render(owner, "eastern");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="路径节点"]')!.options).toHaveLength(5);
  await selectNode(); await choose("我的状态判断", "completed");
  expect(host.textContent).toContain("尚无完成依据"); expect(host.textContent).toContain("投入待明确");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="关联成果"]')!.options).toHaveLength(2);
  await choose("关联成果", evidenceId); await acknowledge();
  await render(owner, "cyberpunk"); expect(button("确认节点状态").disabled).toBe(false);
  await act(async () => button("确认节点状态").click());
  expect(workspace.current[0]?.evidenceId).toBe(evidenceId);
});
