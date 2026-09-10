// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const storage = vi.hoisted(() => ({ addListener: vi.fn(), removeListener: vi.fn() }));
const tabs = vi.hoisted(() => ({ onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }, onActivated: { addListener: vi.fn(), removeListener: vi.fn() } }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: transport,
  tabs,
  storage: { onChanged: storage },
} }));

let root: Root;
let host: HTMLDivElement;
let connected: boolean;
let preferences: { theme: { id: string; version: number }; revision: number };
let preferencesStatus: "current" | "cached" | "unavailable";

beforeEach(() => {
  storage.addListener.mockClear();
  tabs.onUpdated.addListener.mockClear(); tabs.onActivated.addListener.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  connected = true;
  preferences = { theme: { id: "cyberpunk", version: 1 }, revision: 1 };
  preferencesStatus = "current";
  transport.sendMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === "START_SESSION") return { ok: true };
    if (message.type === "LOAD_PREFERENCES") return connected ? { connected: true, userId: "user-a", preferences, preferencesStatus } : { connected: false };
    if (message.type === "LOAD_CONTEXT") return connected ? {
      connected: true, userId: "user-a", email: "learner@example.com", nodes: [], preferences, preferencesStatus,
      tabId: 7, contexts: [{ goalId: "goal-1", goalTitle: "学习目标", stageTitle: "起步", nodeTitle: "了解基础", nodeId: "node-1", resourceBindingId: "binding-1", videoId: "abcdefghijk",
        description: "用三张照片比较曝光组合", completionCriteria: "提交照片并解释取舍", estimatedMinutes: 30 }],
    } : { connected: false };
    throw new Error(`Unexpected browser message: ${message.type}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function clickButton(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

test("learning, understanding and records are keyboard task views without automatic private reads", async () => {
  await act(async () => root.render(<App />));
  const list = host.querySelector('[role="tablist"][aria-label="学习工作台"]');
  expect(list).not.toBeNull();
  const items = [...list!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(items.map(item => item.textContent)).toEqual(["学习", "理解", "记录"]);
  const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  expect(panels.map(panel => panel.hidden)).toEqual([false, true, true]);
  transport.sendMessage.mockClear();
  items[0]!.focus();
  await act(async () => items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(items[1]);
  expect(items.map(item => item.tabIndex)).toEqual([-1, 0, -1]);
  expect(items.map(item => item.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  expect(panels.map(panel => panel.hidden)).toEqual([true, false, true]);
  expect(panels[1]!.textContent).toContain("读取原始字幕");
  expect(host.querySelector('.context-card')?.closest('[hidden]')).toBeNull();
  expect(host.textContent).toContain("了解基础");
  expect(transport.sendMessage.mock.calls).toHaveLength(0);
  await act(async () => items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(document.activeElement).toBe(items[0]);
  expect(panels.map(panel => panel.hidden)).toEqual([false, true, true]);
  for (const [key, selected] of [["ArrowLeft", 2], ["ArrowRight", 0], ["End", 2]] as const) {
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    expect(document.activeElement).toBe(items[selected]);
    expect(items[selected]!.getAttribute("aria-controls")).toBe(panels[selected]!.id);
    expect(panels[selected]!.getAttribute("aria-labelledby")).toBe(items[selected]!.id);
  }
  await clickButton("学习");
  expect(panels.map(panel => panel.hidden)).toEqual([false, true, true]);
});

test("record view offers explicit video notes without automatically reading private notes", async () => {
  await act(async () => root.render(<App />));
  transport.sendMessage.mockClear();
  await clickButton("记录");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "记录视频笔记")).toBe(true);
  expect(transport.sendMessage).not.toHaveBeenCalled();
});

test("continue-learning stays mounted across task, theme and video changes but resets on account change", async () => {
  localStorage.clear();
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async message => message.type === "LOAD_LEARNING_POSITIONS"
    ? { ok: true, value: { blueprint: { schemaVersion: 2, id: "fd580000-0000-4000-8000-000000000001", version: 2, title: "私人位置路径", goals: [] }, records: [] } }
    : original(message));
  await act(async () => root.render(<App />));
  expect(transport.sendMessage.mock.calls.some(([message]) => message.type === "LOAD_LEARNING_POSITIONS")).toBe(false);
  await clickButton("继续学习");
  const field = host.querySelector('[aria-label="继续学习位置（秒）"]'); expect(field).not.toBeNull();
  expect(field!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  transport.sendMessage.mockClear();
  await clickButton("记录"); expect(field!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
  await clickButton("理解"); expect(host.querySelector('[aria-label="继续学习位置（秒）"]')).toBe(field);
  await clickButton("学习"); expect(host.querySelector('[aria-label="继续学习位置（秒）"]')).toBe(field);
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => tabs.onActivated.addListener.mock.calls[0]![0]({ tabId: 8 }));
  expect(host.querySelector('[aria-label="继续学习位置（秒）"]')).toBe(field);
  expect(transport.sendMessage.mock.calls.some(([message]) => message.type === "LOAD_LEARNING_POSITIONS" || message.type === "SAVE_LEARNING_POSITION")).toBe(false);
  transport.sendMessage.mockResolvedValue({ connected: true, userId: "user-b", nodes: [], preferences });
  await act(async () => storage.addListener.mock.calls[0]![0]({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" }, newValue: { userId: "user-b" } } }, "local"));
  expect(host.querySelector('[aria-label="继续学习位置（秒）"]')).toBeNull();
});

test("video notes stay mounted across tasks, themes and active video changes but are hidden on account change", async () => {
  localStorage.clear();
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async message => message.type === "LOAD_LEARNING_NOTES"
    ? { ok: true, value: { blueprint: { schemaVersion: 2, id: "fd520000-0000-4000-8000-000000000001", version: 2, title: "私人笔记路径", goals: [] }, records: [] } }
    : original(message));
  await act(async () => root.render(<App />));
  await clickButton("记录"); await clickButton("记录视频笔记");
  const textarea = host.querySelector('[aria-label="笔记原文"]'); expect(textarea).not.toBeNull();
  transport.sendMessage.mockClear();
  await clickButton("学习"); expect(textarea!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
  await clickButton("理解"); expect(host.querySelector('[aria-label="笔记原文"]')).toBe(textarea);
  await clickButton("记录"); expect(host.querySelector('[aria-label="笔记原文"]')).toBe(textarea);
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => tabs.onActivated.addListener.mock.calls[0]![0]({ tabId: 8 }));
  expect(host.querySelector('[aria-label="笔记原文"]')).toBe(textarea);
  expect(transport.sendMessage.mock.calls.some(([message]) => message.type === "LOAD_LEARNING_NOTES" || message.type === "SAVE_LEARNING_NOTE")).toBe(false);
  transport.sendMessage.mockResolvedValue({ connected: true, userId: "user-b", nodes: [], preferences });
  await act(async () => storage.addListener.mock.calls[0]![0]({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" }, newValue: { userId: "user-b" } } }, "local"));
  expect(host.querySelector('[aria-label="笔记原文"]')).toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("学习");
});

test("record tasks retain the mounted private workspace across tabs, video and theme but reset for a different account", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async message => message.type === "LOAD_NODE_STATUS"
    ? { ok: true, value: { blueprint: { schemaVersion: 2, id: "fd500000-0000-4000-8000-000000000001", version: 2, title: "私人路径", goals: [] }, current: [], history: [], evidence: { ok: true, value: [] } } }
    : original(message));
  await act(async () => root.render(<App />));
  await clickButton("记录");
  await clickButton("核对节点状态");
  const select = host.querySelector('[aria-label="路径节点"]');
  expect(select).not.toBeNull();
  transport.sendMessage.mockClear();
  await clickButton("学习");
  expect(select!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
  await clickButton("记录");
  expect(host.querySelector('[aria-label="路径节点"]')).toBe(select);
  expect(select!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  expect(transport.sendMessage.mock.calls).toHaveLength(0);
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => tabs.onActivated.addListener.mock.calls[0]![0]({ tabId: 8 }));
  expect(host.querySelector('[aria-label="路径节点"]')).toBe(select);
  expect(select!.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  expect(transport.sendMessage.mock.calls.some(([message]) => message.type === "LOAD_NODE_STATUS")).toBe(false);
  transport.sendMessage.mockResolvedValue({ connected: true, userId: "user-b", nodes: [], preferences });
  await act(async () => storage.addListener.mock.calls[0]![0]({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" }, newValue: { userId: "user-b" } } }, "local"));
  expect(host.querySelector('[aria-label="路径节点"]')).toBeNull();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("学习");
});

test("a revoked connection does not keep a previous learning success message", async () => {
  await act(async () => root.render(<App />));
  await clickButton("开始学习");
  expect(host.textContent).toContain("学习会话已写入你的蓝图");
  connected = false;
  await clickButton("刷新");
  expect(host.textContent).toContain("连接你的蓝图");
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
});

test("opens an account-bound evidence journal without starting a learning session", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async (message) => message.type === "LOAD_EVIDENCE"
    ? { ok: true, value: { blueprint: { schemaVersion: 1, id: "018f6f68-9b4d-7c93-a134-c8571b8f7801", version: 1, title: "学习路径", goals: [] }, records: { ok: true, value: [] } } }
    : original(message));
  await act(async () => root.render(<App />));
  transport.sendMessage.mockClear();
  await clickButton("记录");
  await clickButton("记录学习收获");
  expect(host.textContent).toContain("留下一次真实的进步");
  expect(transport.sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: "LOAD_EVIDENCE", ownerId: "user-a" }]);
  await clickButton("收起成果记录");
  expect(host.querySelector<HTMLElement>('[aria-label="成果记录"]')?.hidden).toBe(true);
  await clickButton("记录学习收获");
  expect(transport.sendMessage.mock.calls).toHaveLength(1);
});

test("the real App follows account theme changes on focus without losing learning state or focused nodes", async () => {
  await act(async () => root.render(<App />));
  await clickButton("开始学习");
  const learning = [...host.querySelectorAll("button")].find((button) => button.textContent === "开始学习")!;
  learning.focus();
  transport.sendMessage.mockClear();
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
  expect(host.querySelector("[data-bp-density]")?.getAttribute("data-bp-density")).toBe("compact");
  expect(host.textContent).toContain("了解基础");
  expect(host.textContent).toContain("学习会话已写入你的蓝图");
  expect(document.activeElement).toBe(learning);
  expect(transport.sendMessage.mock.calls.map(([message]) => message.type)).toEqual(["LOAD_PREFERENCES"]);
});

test("a late preference refresh cannot override a newer account theme or reconnect after revocation", async () => {
  await act(async () => root.render(<App />));
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await act(async () => window.dispatchEvent(new Event("focus")));
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => release({ connected: true, userId: "user-a", preferences: { theme: { id: "cyberpunk", version: 1 }, revision: 1 }, preferencesStatus: "current" }));
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
  connected = false;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toContain("连接你的蓝图");
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("cyberpunk");
});

test("an account switch clears the previous owner's learning message and theme before the new context arrives", async () => {
  preferences = { theme: { id: "eastern", version: 1 }, revision: 2 };
  await act(async () => root.render(<App />));
  await clickButton("开始学习");
  const onStorageChanged = storage.addListener.mock.calls[0]?.[0];
  expect(onStorageChanged).toBeTypeOf("function");
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await act(async () => onStorageChanged({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" }, newValue: { userId: "user-b" } } }, "local"));
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
  expect(host.textContent).not.toContain("了解基础");
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("cyberpunk");
  await act(async () => release({ connected: true, userId: "user-b", nodes: [], preferences: null, preferencesStatus: "unavailable" }));
  expect(host.textContent).toContain("暂时无法读取账号主题");
  expect(host.textContent).not.toContain("当前显示缓存蓝图");
});

test("a learning result arriving after an account switch cannot show success on the new account", async () => {
  await act(async () => root.render(<App />));
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await clickButton("开始学习");
  transport.sendMessage.mockResolvedValue({ connected: true, userId: "user-b", nodes: [], preferences: null, preferencesStatus: "unavailable" });
  await act(async () => storage.addListener.mock.calls[0]![0]({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" }, newValue: { userId: "user-b" } } }, "local"));
  await act(async () => release({ ok: true }));
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
});

test("a delayed logout cannot hide the account connected through the newly available login control", async () => {
  await act(async () => root.render(<App />));
  const onStorageChanged = storage.addListener.mock.calls[0]![0];
  let owner: string | null = "user-a";
  let finishLogout!: (value: unknown) => void;
  transport.sendMessage.mockImplementation(async ({ type }: { type: string }) => {
    if (type === "AUTH_DISCONNECT") {
      owner = null;
      onStorageChanged({ blueprint_cloud_session_v1: { oldValue: { userId: "user-a" } } }, "local");
      return new Promise((resolve) => { finishLogout = resolve; });
    }
    if (type === "AUTH_CONNECT") {
      owner = "user-b";
      onStorageChanged({ blueprint_cloud_session_v1: { newValue: { userId: owner } } }, "local");
      return { connected: true, userId: owner };
    }
    if (type === "LOAD_CONTEXT") return owner ? {
      connected: true, userId: owner, email: "next-account@example.test", nodes: [],
      preferences: { theme: { id: "eastern", version: 1 }, revision: 1 }, preferencesStatus: "current",
      contexts: [{ nodeId: "node-b", nodeTitle: "新账号当前节点", goalTitle: "新目标", stageTitle: "起步" }],
    } : { connected: false };
    throw new Error(`Unexpected browser message: ${type}`);
  });
  await clickButton("退出");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "连接 Blueprint")?.disabled).toBe(false);
  await clickButton("连接 Blueprint");
  expect(host.textContent).toContain("新账号当前节点");
  await act(async () => finishLogout({ connected: false }));
  expect(host.textContent).toContain("next-account@example.test");
  expect(host.textContent).toContain("新账号当前节点");
  expect(host.textContent).not.toContain("扩展会话已退出");
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
});

test("the learning context explains purpose, expected evidence and time and returns to the exact node", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async message => message.type === "OPEN_PATH" ? { ok: true } : original(message));
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain("用三张照片比较曝光组合");
  expect(host.textContent).toContain("提交照片并解释取舍");
  expect(host.textContent).toContain("30 分钟");
  await clickButton("返回此节点路径");
  expect(transport.sendMessage).toHaveBeenCalledWith({ type: "OPEN_PATH", ownerId: "user-a", tabId: 7, context: { nodeId: "node-1", resourceBindingId: "binding-1" } });
  await clickButton("开始学习");
  expect(transport.sendMessage).toHaveBeenCalledWith({ type: "START_SESSION", ownerId: "user-a", tabId: 7, context: { nodeId: "node-1", resourceBindingId: "binding-1" } });
});

test("a shared video requires explicit node choice and retains that choice on refresh but not another tab", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  let tabId = 7;
  transport.sendMessage.mockImplementation(async message => {
    const result = await original(message);
    return message.type === "LOAD_CONTEXT" ? { ...result, tabId, contexts: [result.contexts[0], { ...result.contexts[0], nodeId: "node-2", resourceBindingId: "binding-2", nodeTitle: "进阶实践", completionCriteria: "独立重拍三张照片" }] } : result;
  });
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain("同一视频关联了多个节点");
  expect([...host.querySelectorAll("button")].find(button => button.textContent === "开始学习")).toBeUndefined();
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="本次学习节点"]');
  expect(select).not.toBeNull();
  await act(async () => { select!.value = "binding-2"; select!.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("独立重拍三张照片");
  await clickButton("刷新");
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="本次学习节点"]')?.value).toBe("binding-2");
  await clickButton("开始学习");
  expect(transport.sendMessage).toHaveBeenCalledWith({ type: "START_SESSION", ownerId: "user-a", tabId: 7, context: { nodeId: "node-2", resourceBindingId: "binding-2" } });
  tabId = 8;
  await act(async () => tabs.onActivated.addListener.mock.calls[0]![0]({ tabId: 8, windowId: 1 }));
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="本次学习节点"]')?.value).toBe("");
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
});

test("navigation hides old video context immediately and ignores its late learning receipt", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  await act(async () => root.render(<App />));
  let finishLearning!: (value: unknown) => void;
  let finishContext!: (value: unknown) => void;
  transport.sendMessage.mockImplementation(message => message.type === "START_SESSION" ? new Promise(resolve => { finishLearning = resolve; })
    : message.type === "LOAD_CONTEXT" ? new Promise(resolve => { finishContext = resolve; }) : original(message));
  await clickButton("开始学习");
  const updated = tabs.onUpdated.addListener.mock.calls[0]![0];
  await act(async () => updated(99, { url: "https://www.youtube.com/watch?v=12345678901" }));
  expect(host.textContent).toContain("提交照片并解释取舍");
  await act(async () => updated(7, { url: "https://www.youtube.com/watch?v=lmnopqrstuv" }));
  expect(host.textContent).not.toContain("提交照片并解释取舍");
  expect(host.textContent).toContain("正在核对当前视频");
  await act(async () => finishLearning({ ok: true }));
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
  await act(async () => finishContext({ connected: true, userId: "user-a", tabId: 7, contexts: [], preferences }));
  expect(host.textContent).toContain("没有匹配的蓝图节点");
});

test("legacy paths use honest missing-context text and a failed refresh disables old actions", async () => {
  const original = transport.sendMessage.getMockImplementation()!;
  transport.sendMessage.mockImplementation(async message => {
    const result = await original(message);
    return message.type === "LOAD_CONTEXT" ? { ...result, contexts: [{ ...result.contexts[0], description: null, completionCriteria: "", estimatedMinutes: null }], stale: true } : result;
  });
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain("路径尚未填写学习说明");
  expect(host.textContent).toContain("不以观看时长判断掌握");
  expect(host.textContent).toContain("当前显示缓存蓝图");
  transport.sendMessage.mockRejectedValueOnce(new Error("background unavailable"));
  await clickButton("刷新");
  expect(host.textContent).toContain("无法连接 Blueprint 后台");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "开始学习" || button.textContent === "返回此节点路径")).toBe(false);
});
