// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const storage = vi.hoisted(() => ({ addListener: vi.fn(), removeListener: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: transport,
  tabs: { onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
  storage: { onChanged: storage },
} }));

let root: Root;
let host: HTMLDivElement;
let connected: boolean;
let preferences: { theme: { id: string; version: number }; revision: number };
let preferencesStatus: "current" | "cached" | "unavailable";

beforeEach(() => {
  storage.addListener.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  connected = true;
  preferences = { theme: { id: "cyberpunk", version: 1 }, revision: 1 };
  preferencesStatus = "current";
  transport.sendMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === "START_SESSION") return { ok: true };
    if (message.type === "LOAD_PREFERENCES") return connected ? { connected: true, userId: "user-a", preferences, preferencesStatus } : { connected: false };
    if (message.type === "LOAD_CONTEXT") return connected ? {
      connected: true, userId: "user-a", email: "learner@example.com", nodes: [], preferences, preferencesStatus,
      context: { goalTitle: "学习目标", stageTitle: "起步", nodeTitle: "了解基础", nodeId: "node-1" },
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

test("a revoked connection does not keep a previous learning success message", async () => {
  await act(async () => root.render(<App />));
  await clickButton("开始学习");
  expect(host.textContent).toContain("学习会话已写入你的蓝图");
  connected = false;
  await clickButton("刷新");
  expect(host.textContent).toContain("连接你的蓝图");
  expect(host.textContent).not.toContain("学习会话已写入你的蓝图");
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
      context: { nodeId: "node-b", nodeTitle: "新账号当前节点", goalTitle: "新目标", stageTitle: "起步" },
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
