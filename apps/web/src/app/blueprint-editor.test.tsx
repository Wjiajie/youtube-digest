// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { diffBlueprints, prepareBlueprintDraft, type ApplicationResult, type BlueprintProposalRecord, type BlueprintSnapshot } from "@blueprint/domain";
import { BlueprintEditor } from "./blueprint-editor";
import { ThemeSurface } from "@blueprint/ui/theme";

const initial: BlueprintSnapshot = {
  schemaVersion: 1,
  id: "018f6f68-9b4d-7c93-a134-c8571b8f7701",
  version: 1,
  title: "我的蓝图",
  goals: [],
};
let root: Root;
let host: HTMLDivElement;
const withNode: BlueprintSnapshot = { ...initial, goals: [{
  id: "018f6f68-9b4d-7c93-a134-c8571b8f7711", title: "表达", position: 0, stages: [{
    id: "018f6f68-9b4d-7c93-a134-c8571b8f7721", title: "练习", position: 0, nodes: [{
      id: "018f6f68-9b4d-7c93-a134-c8571b8f7731", title: "独立演讲", type: "practice", position: 0, dependencyIds: [], resources: [],
    }],
  }],
}] };
async function edit(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  expect(element).not.toBeNull();
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("a legacy practice node starts with unknown planning and keeps new text through both themes", async () => {
  await act(async () => root.render(<ThemeSurface theme="cyberpunk"><BlueprintEditor initial={withNode} sessions={[]} /></ThemeSurface>));
  const minutes = host.querySelector<HTMLInputElement>('[aria-label="预计投入（分钟）"]');
  expect(minutes).not.toBeNull();
  expect(minutes!.value).toBe("");
  await edit("预计投入（分钟）", "45");
  await edit("完成依据", "录制演讲并收集三条反馈");
  const criteria = host.querySelector<HTMLTextAreaElement>('[aria-label="完成依据"]')!;
  criteria.focus(); criteria.setSelectionRange(1, 4);
  await act(async () => root.render(<ThemeSurface theme="eastern"><BlueprintEditor initial={withNode} sessions={[]} /></ThemeSurface>));
  expect(host.querySelector('[aria-label="完成依据"]')).toBe(criteria);
  expect(criteria.value).toBe("录制演讲并收集三条反馈");
  expect([criteria.selectionStart, criteria.selectionEnd]).toEqual([1, 4]);
  expect(document.activeElement).toBe(criteria);
  expect(withNode.schemaVersion).toBe(1);
  expect(withNode.goals[0]!.stages[0]!.nodes[0]!.estimatedMinutes).toBeUndefined();
});

test("metadata-only changes show actual before and after values and wait for explicit application", async () => {
  const saved = prepareBlueprintDraft(withNode);
  saved.goals[0]!.stages[0]!.nodes[0]!.estimatedMinutes = 30;
  saved.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "录制初稿";
  let submitted: BlueprintSnapshot | undefined;
  let applied = false;
  await act(async () => root.render(<BlueprintEditor initial={saved} sessions={[]}
    createAction={async input => {
      submitted = input.draft;
      return { ok: true, value: { id: "018f6f68-9b4d-7c93-a134-c8571b8f7791", ownerId: saved.id,
        blueprintId: saved.id, baseVersion: saved.version, proposedSnapshot: input.draft,
        proposedDiff: diffBlueprints(saved, input.draft), status: "pending", clientMutationId: input.clientMutationId, createdAt: "2026-09-10T00:00:00Z" } };
    }} applyAction={async () => { applied = true; return { ok: false, code: "unavailable" }; }} />));
  await edit("预计投入（分钟）", "45");
  await edit("完成依据", "录制终稿并收集三条反馈");
  await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.click());
  const preview = host.querySelector('[aria-label="节点投入与完成依据变更"]');
  expect(preview).not.toBeNull();
  expect(preview!.textContent).toContain("30 分钟");
  expect(preview!.textContent).toContain("45 分钟");
  expect(preview!.textContent).toContain("录制初稿");
  expect(preview!.textContent).toContain("录制终稿并收集三条反馈");
  expect(submitted?.schemaVersion).toBe(2);
  expect(submitted?.version).toBe(1);
  expect(applied).toBe(false);
  expect(saved.goals[0]!.stages[0]!.nodes[0]!.estimatedMinutes).toBe(30);
  await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "确认并应用")!.click());
  expect(applied).toBe(true);
});

test("versioned recovery retains invalid minutes for correction without replacing a legacy cache", async () => {
  const legacyKey = `blueprint-draft:${withNode.id}`;
  const legacy = JSON.stringify({ baseVersion: 1, draft: withNode, resourceUrls: {} });
  localStorage.setItem(legacyKey, legacy);
  await act(async () => root.render(<BlueprintEditor initial={withNode} sessions={[]} />));
  await edit("预计投入（分钟）", "1.5");
  await edit("完成依据", "保留待核对的完成依据");
  expect(localStorage.getItem(`blueprint-draft:v2:${withNode.id}`)).not.toBeNull();
  expect(localStorage.getItem(legacyKey)).toBe(legacy);
  await act(async () => root.render(null));
  await act(async () => root.render(<BlueprintEditor initial={withNode} sessions={[]} />));
  expect(host.querySelector<HTMLInputElement>('[aria-label="预计投入（分钟）"]')!.value).toBe("1.5");
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="完成依据"]')!.value).toBe("保留待核对的完成依据");
  expect(host.textContent).not.toContain("格式无法识别");
});

test("invalid node minutes never leave the editor and clearing planning submits explicit unknown values", async () => {
  const saved = prepareBlueprintDraft(withNode);
  saved.goals[0]!.stages[0]!.nodes[0]!.estimatedMinutes = 90;
  saved.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "原完成依据";
  const submitted: BlueprintSnapshot[] = [];
  await act(async () => root.render(<BlueprintEditor initial={saved} sessions={[]} createAction={async input => {
    submitted.push(input.draft); return { ok: false, code: "invalid" };
  }} />));
  for (const value of ["-1", "1.5", "0", "2147483648"]) {
    await edit("预计投入（分钟）", value);
    await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.click());
    expect(submitted).toHaveLength(0);
    expect(host.textContent).toContain("整数分钟");
  }
  await edit("预计投入（分钟）", ""); await edit("完成依据", "");
  await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.click());
  expect(submitted).toHaveLength(1);
  expect(submitted[0]?.goals[0]?.stages[0]?.nodes[0]).toMatchObject({ estimatedMinutes: null, completionCriteria: "", resources: [] });
  expect(host.textContent).toContain("旧提案不会自动转换或应用");
});

test("pending proposal creation freezes planning inputs so its receipt cannot replace newer edits", async () => {
  let release!: (result: ApplicationResult<BlueprintProposalRecord>) => void;
  const response = new Promise<ApplicationResult<BlueprintProposalRecord>>(resolve => { release = resolve; });
  await act(async () => root.render(<BlueprintEditor initial={withNode} sessions={[]} createAction={async () => response} />));
  await edit("预计投入（分钟）", "45"); await edit("完成依据", "待确认的依据");
  await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.click());
  expect(host.querySelector('[aria-label="预计投入（分钟）"]')!.matches(":disabled")).toBe(true);
  expect(host.querySelector('[aria-label="完成依据"]')!.matches(":disabled")).toBe(true);
  await edit("完成依据", "请求期间不可替换");
  await edit("预计投入（分钟）", "60");
  await act(async () => release({ ok: false, code: "unavailable" }));
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="完成依据"]')!.value).toBe("待确认的依据");
  expect(host.querySelector<HTMLInputElement>('[aria-label="预计投入（分钟）"]')!.value).toBe("45");
});

test("malformed current-format recovery remains available to copy and cannot silently drop required node fields", async () => {
  const key = `blueprint-draft:v2:${withNode.id}`;
  const raw = JSON.stringify({ schemaVersion: 2, baseVersion: 1, draft: { ...withNode, schemaVersion: 2 }, resourceUrls: {}, minutesInputs: {} });
  localStorage.setItem(key, raw);
  await act(async () => root.render(<BlueprintEditor initial={withNode} sessions={[]} />));
  expect(localStorage.getItem(key)).toBe(raw);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原始恢复内容"]')!.value).toBe(raw);
  expect([...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.disabled).toBe(true);
});

test("editing only planning preserves all existing resource alternatives", async () => {
  const saved = prepareBlueprintDraft(withNode);
  const resources = [
    { id: "018f6f68-9b4d-7c93-a134-c8571b8f7741", kind: "youtube_video" as const, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", externalId: "dQw4w9WgXcQ" },
    { id: "018f6f68-9b4d-7c93-a134-c8571b8f7742", kind: "youtube_video" as const, url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", externalId: "aqz-KE-bpKQ" },
  ];
  saved.goals[0]!.stages[0]!.nodes[0]!.resources = resources;
  let submitted: BlueprintSnapshot | undefined;
  await act(async () => root.render(<BlueprintEditor initial={saved} sessions={[]} createAction={async input => {
    submitted = input.draft; return { ok: false, code: "invalid" };
  }} />));
  await edit("预计投入（分钟）", "60");
  await edit("完成依据", "比较两份参考资料并形成自己的说明");
  await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "查看修改")!.click());
  expect(submitted?.goals[0]?.stages[0]?.nodes[0]?.resources).toEqual(resources);
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("opening an unchanged saved blueprint does not claim to recover unsaved changes", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: initial, resourceUrls: {},
  }));
  await act(async () => root.render(<BlueprintEditor initial={initial} sessions={[]} />));
  expect(host.textContent).not.toContain("已恢复上次尚未确认的修改");
});

test("opening a blueprint restores an actual unsaved edit", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: { ...initial, title: "职业成长蓝图" }, resourceUrls: {},
  }));
  await act(async () => root.render(<BlueprintEditor initial={initial} sessions={[]} />));
  expect(host.querySelector("input")?.value).toBe("职业成长蓝图");
  expect(host.textContent).toContain("已恢复上次尚未确认的修改");
});

test("switching both themes keeps the real editor draft and text selection without a blueprint revision", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: { ...initial, title: "尚未确认的职业成长蓝图" }, resourceUrls: {},
  }));
  await act(async () => root.render(<ThemeSurface theme="cyberpunk"><BlueprintEditor initial={initial} sessions={[]} /></ThemeSurface>));
  const input = host.querySelector("input")!;
  input.focus();
  input.setSelectionRange(2, 5);
  const recovery = localStorage.getItem(`blueprint-draft:${initial.id}`);
  for (const theme of ["eastern", "cyberpunk"] as const) {
    await act(async () => root.render(<ThemeSurface theme={theme}><BlueprintEditor initial={initial} sessions={[]} /></ThemeSurface>));
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("尚未确认的职业成长蓝图");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(input);
    expect(localStorage.getItem(`blueprint-draft:${initial.id}`)).toBe(recovery);
  }
  expect(initial.version).toBe(1);
});
