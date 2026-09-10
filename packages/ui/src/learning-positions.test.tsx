// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordLearningPositionSchema, type ApplicationResult, type LearningPosition, type LearningPositionWorkspace as Workspace } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { LearningPositionWorkspace } from "./learning-positions";

const id = (n: number) => `fd580000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), binding = id(6), storageKey = `blueprint-learning-position:v1:${owner}:${id(2)}`;
const initial: Workspace = { blueprint: { schemaVersion: 2, id: id(2), version: 1, title: "摄影路径", goals: [{ id: id(3), title: "记录光线", position: 0,
  stages: [{ id: id(4), title: "第一周", position: 0, nodes: [{ id: id(5), title: "观察曝光", type: "learn", position: 0, estimatedMinutes: 30,
    completionCriteria: "解释曝光变化", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] }, records: [] };
let host: HTMLDivElement, root: Root, workspace: Workspace, writes: unknown[], reads: (string | undefined)[];
let save: (input: unknown) => Promise<ApplicationResult<LearningPosition>>, read: (binding?: string) => Promise<ApplicationResult<Workspace>>;
let capture: ((videoId: string) => Promise<ApplicationResult<{ videoId: string; positionSeconds: number }>>) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); workspace = structuredClone(initial); writes = []; reads = []; capture = undefined;
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (key: string, _: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (held.has(key)) return callback(null); held.add(key); try { await callback({}); } finally { held.delete(key); }
  } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save = async input => {
    writes.push(input); const command = recordLearningPositionSchema.parse(input);
    const value: LearningPosition = { id: crypto.randomUUID(), clientMutationId: command.clientMutationId, positionSeconds: command.positionSeconds,
      expectedPositionVersion: command.expectedPositionVersion, positionVersion: command.expectedPositionVersion + 1,
      context: { blueprintId: id(2), blueprintVersion: command.expectedVersion, goalId: id(3), goalTitle: "记录光线", stageId: id(4), stageTitle: "第一周",
        nodeId: command.nodeId, nodeTitle: "观察曝光", nodeType: "learn" }, resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-11T00:00:00Z" };
    workspace.records = [value]; return { ok: true, value };
  };
  read = async bindingId => { reads.push(bindingId); return { ok: true, value: structuredClone(workspace) }; };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(accountId = owner, theme: "cyberpunk" | "eastern" = "cyberpunk", start = initial) {
  await act(async () => root.render(<ThemeSurface theme={theme}><LearningPositionWorkspace accountId={accountId} initial={start} saveAction={save} reloadAction={read} capturePosition={capture} /></ThemeSurface>));
}
function button(label: string) { return Array.from(host.querySelectorAll("button")).find(button => button.textContent === label)!; }
async function fill(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function prepare() {
  await fill("继续学习关联视频", binding); await act(async () => button("读取所选视频位置").click());
  await act(async () => button("使用此来源与最新位置版本").click());
}

test("explicitly choose, read, confirm and save zero without manufacturing watched progress", async () => {
  await render(); expect(reads).toEqual([]); expect(writes).toEqual([]);
  await prepare(); expect(reads).toEqual([binding]);
  await fill("继续学习位置（秒）", "0"); await act(async () => button("保存继续学习位置").click());
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ nodeId: id(5), resourceBindingId: binding, expectedVersion: 1, expectedPositionVersion: 0, positionSeconds: 0 });
  expect(host.textContent).toContain("位置已保存");
  expect(host.querySelector('.position-history a[target="_blank"]')?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=0s");
});

test("response loss freezes a durable original request across remount and requires explicit exact recovery", async () => {
  const realSave = save; let original: unknown, receipt: ApplicationResult<LearningPosition>;
  save = async input => { original = input; receipt = await realSave(input); return { ok: false, code: "unavailable" }; };
  await render(); await prepare(); await fill("继续学习位置（秒）", "125");
  await act(async () => button("保存继续学习位置").click());
  expect(host.textContent).toContain("尚未确认保存结果");
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toEqual(original);
  await act(async () => root.unmount()); root = createRoot(host);
  save = async input => { writes.push(input); return receipt; };
  await render(); expect(writes).toHaveLength(1);
  await act(async () => button("确认原位置提交").click());
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]); expect(host.textContent).toContain("位置已保存");
});

test("a second same-account tab cannot edit or overwrite the first tab's position draft", async () => {
  await render(); await prepare(); await fill("继续学习位置（秒）", "32");
  const otherHost = document.createElement("div"), otherRoot = createRoot(otherHost); document.body.append(otherHost);
  try {
    await act(async () => otherRoot.render(<LearningPositionWorkspace accountId={owner} initial={initial} saveAction={save} reloadAction={read} />));
    expect(otherHost.textContent).toContain("另一标签页正在编辑");
    expect(otherHost.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(storageKey)!).position).toBe("32");
  } finally { await act(async () => otherRoot.unmount()); otherHost.remove(); }
});

test("a rejected position keeps manual input and requires fresh read plus explicit version confirmation", async () => {
  const realSave = save; save = async () => ({ ok: false, code: "version_conflict" });
  await render(); await prepare(); await fill("继续学习位置（秒）", "42");
  await act(async () => button("保存继续学习位置").click());
  expect(host.textContent).toContain("本次保存已被拒绝"); expect(button("保存继续学习位置").disabled).toBe(true);
  await realSave({ nodeId: id(5), resourceBindingId: binding, expectedVersion: 1, expectedPositionVersion: 0, positionSeconds: 120, clientMutationId: id(20) });
  await act(async () => button("读取所选视频位置").click());
  expect(host.textContent).toContain("云端保存：120 秒"); expect(button("保存继续学习位置").disabled).toBe(true);
  await act(async () => button("使用此来源与最新位置版本").click());
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("42");
  save = realSave; await render(); await act(async () => button("保存继续学习位置").click());
  expect(writes.at(-1)).toMatchObject({ positionSeconds: 42, expectedPositionVersion: 1 });
});

test("recovering an older successful receipt never replaces a newer cloud position", async () => {
  const realSave = save; let old!: ApplicationResult<LearningPosition>;
  save = async input => { old = await realSave(input); return { ok: false, code: "unavailable" }; };
  await render(); await prepare(); await fill("继续学习位置（秒）", "42"); await act(async () => button("保存继续学习位置").click());
  await realSave({ nodeId: id(5), resourceBindingId: binding, expectedVersion: 1, expectedPositionVersion: 1, positionSeconds: 200, clientMutationId: id(21) });
  await act(async () => root.unmount()); root = createRoot(host); save = async () => old;
  await render(owner, "cyberpunk", structuredClone(workspace)); await act(async () => button("确认原位置提交").click());
  expect(host.querySelector('.position-history a[target="_blank"]')?.getAttribute("href")).toContain("t=200s");
});

test("identity rejection hides private source", async () => {
  await render(); await prepare(); read = async () => ({ ok: false, code: "unauthenticated" }); await render();
  await act(async () => button("读取所选视频位置").click()); expect(host.textContent).toContain("账号或登录状态已变化");
  expect(host.querySelector("select")).toBeNull();
});

test("late player capture cannot enter a different account or overwrite its recovery storage", async () => {
  let resolve!: (value: ApplicationResult<{ videoId: string; positionSeconds: number }>) => void;
  capture = () => new Promise(done => { resolve = done; });
  await render(); await prepare(); await fill("继续学习位置（秒）", "42");
  await act(async () => button("读取当前播放位置").click());
  await render(id(99));
  await act(async () => resolve({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 500 } }));
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("");
  expect(JSON.parse(localStorage.getItem(storageKey)!).position).toBe("42");
  expect(localStorage.getItem(`blueprint-learning-position:v1:${id(99)}:${id(2)}`)).toBeNull();
  expect(writes).toEqual([]);
});

test("unwritable recovery storage prevents sending a request while preserving manual input", async () => {
  await render(); await prepare(); await fill("继续学习位置（秒）", "42");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
  await fill("继续学习位置（秒）", "99"); await act(async () => button("保存继续学习位置").click());
  expect(writes).toEqual([]); expect(host.textContent).toContain("尚未发送");
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("99");
});

test("corrupt recovery remains copyable and untouched until the owner explicitly resets it", async () => {
  localStorage.setItem(storageKey, "unreadable-original"); await render();
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原始位置恢复内容"]')!.value).toBe("unreadable-original");
  expect(host.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
  expect(localStorage.getItem(storageKey)).toBe("unreadable-original");
  await act(async () => button("已另行保存，重置位置草稿").click());
  expect(host.querySelector<HTMLSelectElement>("select")!.disabled).toBe(false); expect(writes).toEqual([]);
});

test("an original request can be recovered after its source was removed", async () => {
  const realSave = save; let receipt!: ApplicationResult<LearningPosition>;
  save = async input => { receipt = await realSave(input); return { ok: false, code: "unavailable" }; };
  await render(); await prepare(); await fill("继续学习位置（秒）", "42"); await act(async () => button("保存继续学习位置").click());
  await act(async () => root.unmount()); root = createRoot(host);
  const archived = structuredClone(workspace); archived.blueprint.version = 2; archived.blueprint.goals = [];
  save = async input => { writes.push(input); return receipt; };
  await render(owner, "eastern", archived); await act(async () => button("确认原位置提交").click());
  expect(writes[1]).toEqual(writes[0]); expect(host.textContent).toContain("位置已保存");
  expect(host.textContent).toContain("历史来源已改变或移除");
  expect(host.querySelector('.position-history a')?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=42s");
});

test("explicit capture fills the selected video's draft, never saves, and rejects another video's position", async () => {
  capture = async videoId => ({ ok: true, value: { videoId, positionSeconds: 0 } });
  await render(); await prepare(); await fill("继续学习位置（秒）", "42"); await act(async () => button("读取当前播放位置").click());
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("0"); expect(writes).toEqual([]);
  capture = async () => ({ ok: true, value: { videoId: "lmnopqrstuv", positionSeconds: 99 } }); await render();
  await act(async () => button("读取当前播放位置").click()); expect(host.textContent).toContain("原位置保留");
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("0");
});

test("explicit history refresh shows another device's position without changing this editor's draft", async () => {
  await render(); await prepare(); await fill("继续学习位置（秒）", "42");
  await save({ nodeId: id(5), resourceBindingId: binding, expectedVersion: 1, expectedPositionVersion: 0, positionSeconds: 120, clientMutationId: id(25) });
  await act(async () => button("读取最新学习位置").click());
  expect(reads.at(-1)).toBeUndefined(); expect(host.textContent).toContain("120");
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("42");
});
