// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { saveGoalBriefSchema, type ApplicationResult, type GoalBrief } from "@blueprint/domain";
import { ThemeSurface } from "@blueprint/ui/theme";
import { GoalBriefEditor } from "./goal-brief-editor";

const account = "c6000000-0000-4000-8000-000000000001";
const id = "c6000000-0000-4000-8000-000000000010";
let host: HTMLDivElement, root: Root;
let cloud: GoalBrief | null;
let save: (input: unknown) => Promise<ApplicationResult<GoalBrief>>;
let read: () => Promise<ApplicationResult<GoalBrief>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); cloud = null;
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      await Promise.resolve(); if (held.has(name)) return callback(null);
      held.add(name); try { await callback({}); } finally { held.delete(name); }
    },
  } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save = async input => {
    const command = saveGoalBriefSchema.parse(input);
    cloud = { id, blueprintId: account, revision: command.expectedRevision + 1,
      content: command.content, status: command.confirm ? "confirmed" : "draft", updatedAt: "2026-09-10T00:00:00Z" };
    return { ok: true, value: cloud };
  };
  read = async () => cloud ? { ok: true, value: cloud } : { ok: false, code: "not_found" };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(navigator, "locks"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(owner = account, theme: "cyberpunk" | "eastern" = "cyberpunk") {
  await act(async () => root.render(<ThemeSurface theme={theme}><GoalBriefEditor accountId={owner} id={id}
    initial={cloud} saveAction={save} reloadAction={read} /></ThemeSurface>));
}
function button(text: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === text)!; }
async function field(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function ready() {
  await field("我希望实现", "完成一次公开演讲"); await field("我的起点", "只有课堂经验");
  await field("每周可投入分钟", "180"); await field("成功的依据", "获得三位听众的反馈");
}

test("saves an incomplete draft, explains readiness, and confirms only a reviewed definition", async () => {
  await render();
  expect(button("确认这版目标定义").disabled).toBe(true);
  await field("我希望实现", "完成一次公开演讲");
  await act(async () => button("保存草稿").click());
  expect(cloud?.status).toBe("draft");
  await ready();
  expect(host.textContent).toContain("未指定期限");
  expect(button("确认这版目标定义").disabled).toBe(false);
  await act(async () => button("确认这版目标定义").click());
  expect(cloud?.status).toBe("confirmed");
  expect(host.textContent).toContain("当前云端定义已确认");
  expect(host.textContent).toContain("尚未生成路径");
  await field("我希望实现", "修订我的演讲目标");
  expect(host.textContent).not.toContain("当前云端定义已确认");
  expect(host.textContent).toContain("修改尚未保存");
});

test("replays an uncertain confirmation exactly after reload, without treating an old receipt as the latest confirmation", async () => {
  const originalSave = save;
  let receipt: GoalBrief;
  const attempts: unknown[] = [];
  save = async input => {
    attempts.push(input); const result = await originalSave(input);
    if (result.ok) receipt = result.value;
    throw new Error("response lost");
  };
  await render(); await ready();
  await act(async () => button("确认这版目标定义").click());
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
  await render("c6000000-0000-4000-8000-000000000002");
  cloud = { ...receipt!, revision: 2, status: "draft", content: { ...receipt!.content, outcome: "另一设备的新目标" } };
  save = async input => { attempts.push(input); return { ok: true, value: receipt! }; };
  await render();
  await act(async () => button("核对原提交结果").click());
  expect(attempts[1]).toEqual(attempts[0]);
  expect(host.textContent).not.toContain("当前云端定义已确认");
  expect(host.textContent).toContain("云端已有更新");
  expect(host.querySelector("textarea")?.value).toBe("完成一次公开演讲");
  expect(button("确认这版目标定义").disabled).toBe(true);
  await act(async () => button("保留我的文字，以当前修订重新核对").click());
  expect(button("确认这版目标定义").disabled).toBe(false);
});

test("keeps another tab readonly, then restores its latest private draft when it explicitly takes over", async () => {
  await render(); await field("我希望实现", "只有我在编辑的目标");
  const second = document.createElement("div"); document.body.append(second); const secondRoot = createRoot(second);
  try {
    await act(async () => secondRoot.render(<GoalBriefEditor accountId={account} id={id} initial={null} saveAction={save} reloadAction={read} />));
    expect(second.querySelector("textarea")?.readOnly).toBe(true);
    expect(second.textContent).toContain("另一标签页");
    await field("我希望实现", "原标签页后来修改的目标");
    await act(async () => root.render(null));
    await act(async () => [...second.querySelectorAll("button")].find(item => item.textContent === "接手编辑")!.click());
    expect(second.querySelector("textarea")?.readOnly).toBe(false);
    expect(second.querySelector("textarea")?.value).toBe("原标签页后来修改的目标");
  } finally { await act(async () => secondRoot.unmount()); second.remove(); }
});

test("preserves malformed recovery verbatim until the user explicitly replaces it", async () => {
  const key = `blueprint-goal-brief:${account}:${id}`;
  localStorage.setItem(key, "{malformed private notes");
  await render();
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原始恢复内容"]')?.value).toBe("{malformed private notes");
  expect(button("保存草稿").disabled).toBe(true);
  expect(localStorage.getItem(key)).toBe("{malformed private notes");
  await act(async () => button("已另行保存原文，重新开始").click());
  expect(button("保存草稿").disabled).toBe(false);
});

test("never sends if the exact pending request cannot be durably saved", async () => {
  let sent = 0; save = async () => { sent++; return { ok: false, code: "unavailable" }; };
  await render(); await ready();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await act(async () => button("确认这版目标定义").click());
  expect(sent).toBe(0); expect(host.textContent).toContain("尚未发送");
  expect(host.querySelector("textarea")?.value).toBe("完成一次公开演讲");
});

test("retains the original pending request when current revision cannot be read after a successful save", async () => {
  await render(); await ready();
  read = async () => ({ ok: false, code: "unavailable" }); await render();
  await act(async () => button("确认这版目标定义").click());
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
  expect(host.textContent).not.toContain("当前云端定义已确认");
  expect(button("核对原提交结果").disabled).toBe(false);
});

test("isolates private drafts by account and keeps focus and text when only the theme changes", async () => {
  await render(); await ready();
  const textarea = host.querySelector("textarea")!; textarea.focus(); textarea.setSelectionRange(1, 3);
  await render(account, "eastern");
  expect(host.querySelector("textarea")).toBe(textarea);
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 3]);
  await render("c6000000-0000-4000-8000-000000000002");
  expect(host.querySelector("textarea")?.value).toBe("");
  await render(); expect(host.querySelector("textarea")?.value).toBe("完成一次公开演讲");
});

test("hides private content when the real action reports that account identity changed", async () => {
  save = async () => ({ ok: false, code: "forbidden" });
  await render(); await ready(); await act(async () => button("保存草稿").click());
  expect(host.textContent).not.toContain("完成一次公开演讲");
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("重新验证账号");
});

test("does not silently overwrite after a version conflict; reading latest keeps the user's words", async () => {
  save = async () => ({ ok: false, code: "version_conflict" });
  await render(); await ready(); await act(async () => button("保存草稿").click());
  expect(button("保存草稿").disabled).toBe(true);
  cloud = { id, blueprintId: account, revision: 2, status: "draft", updatedAt: "2026-09-10T00:00:00Z",
    content: { schemaVersion: 1, outcome: "另一设备目标", startingPoint: "", targetDate: null, weeklyMinutes: null, constraints: "", successCriteria: "" } };
  await act(async () => button("读取当前云端定义").click());
  expect(host.querySelector("textarea")?.value).toBe("完成一次公开演讲");
  await act(async () => button("放弃本机修改，使用云端定义").click());
  expect(host.querySelector("textarea")?.value).toBe("另一设备目标");
});

test("does not replay recovery when its displayed text differs from the immutable request", async () => {
  save = async () => ({ ok: false, code: "unavailable" });
  await render(); await ready(); await act(async () => button("确认这版目标定义").click());
  await act(async () => root.render(null));
  const key = `blueprint-goal-brief:${account}:${id}`;
  const raw = JSON.parse(localStorage.getItem(key)!); raw.fields.outcome = "损坏恢复里不一致的目标";
  localStorage.setItem(key, JSON.stringify(raw));
  await render();
  expect(host.textContent).toContain("恢复格式无法识别");
  expect(button("保存草稿").disabled).toBe(true);
  expect(button("核对原提交结果")).toBeUndefined();
});

test("stops claiming confirmation once the server reports that the displayed revision is stale", async () => {
  await render(); await ready(); await act(async () => button("确认这版目标定义").click());
  expect(host.textContent).toContain("当前云端定义已确认");
  save = async () => ({ ok: false, code: "version_conflict" }); await render();
  await act(async () => button("保存草稿").click());
  expect(host.textContent).not.toContain("当前云端定义已确认");
});

test("Strict Mode does not leave an abandoned lock that prevents editing", async () => {
  await act(async () => root.render(<StrictMode><GoalBriefEditor accountId={account} id={id}
    initial={null} saveAction={save} reloadAction={read} /></StrictMode>));
  expect(button("保存草稿").disabled).toBe(false);
  await field("我希望实现", "保留严格模式中的目标");
  expect(host.querySelector("textarea")?.value).toBe("保留严格模式中的目标");
});

test("refuses editing when the browser cannot provide a safe cross-tab lock", async () => {
  Reflect.deleteProperty(navigator, "locks"); await render();
  expect(button("保存草稿").disabled).toBe(true);
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
  expect(host.textContent).toContain("浏览器无法提供安全编辑锁");
});

test("a failed recovery read does not replace potentially existing private data", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("read denied"); });
  await render(); expect(button("保存草稿").disabled).toBe(true);
  expect(host.textContent).toContain("无法读取本机恢复内容");
  expect(write).not.toHaveBeenCalled();
});

test("serializes takeover reads with manual reloads so a late older read cannot replace newer state", async () => {
  await render(); await ready(); await act(async () => button("确认这版目标定义").click());
  const prior = cloud!;
  let release!: (value: ApplicationResult<GoalBrief>) => void;
  const pending = new Promise<ApplicationResult<GoalBrief>>(resolve => { release = resolve; });
  let reads = 0;
  const second = document.createElement("div"); document.body.append(second); const secondRoot = createRoot(second);
  const secondRead = async () => { reads++; return reads === 1 ? pending : { ok: true as const, value: { ...prior, revision: 2, status: "draft" as const } }; };
  try {
    await act(async () => secondRoot.render(<GoalBriefEditor accountId={account} id={id} initial={prior} saveAction={save} reloadAction={secondRead} />));
    await act(async () => root.render(null));
    await act(async () => [...second.querySelectorAll("button")].find(item => item.textContent === "接手编辑")!.click());
    const reload = [...second.querySelectorAll("button")].find(item => item.textContent === "读取当前云端定义")!;
    await act(async () => reload.click());
    expect(reads).toBe(1);
    expect(reload.disabled).toBe(true);
    await act(async () => release({ ok: true, value: prior }));
    await act(async () => reload.click());
    expect(reads).toBe(2);
    expect(second.textContent).not.toContain("当前云端定义已确认");
  } finally { await act(async () => { release({ ok: true, value: prior }); }); await act(async () => secondRoot.unmount()); second.remove(); }
});
