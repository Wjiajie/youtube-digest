// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { ThemeSurface } from "@blueprint/ui/theme";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: transport,
  tabs: { onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
} }));

let root: Root;
let host: HTMLDivElement;
let connected: boolean;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  connected = true;
  transport.sendMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === "START_SESSION") return { ok: true };
    if (message.type === "LOAD_CONTEXT") return connected ? {
      connected: true, email: "learner@example.com", nodes: [],
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

test("theme changes retain the learning context and do not restart a learning session or reload data", async () => {
  await act(async () => root.render(<ThemeSurface theme="cyberpunk" density="compact"><App /></ThemeSurface>));
  await clickButton("开始学习");
  transport.sendMessage.mockClear();
  await act(async () => root.render(<ThemeSurface theme="eastern" density="compact"><App /></ThemeSurface>));
  expect(host.textContent).toContain("了解基础");
  expect(host.textContent).toContain("学习会话已写入你的蓝图");
  expect(transport.sendMessage).not.toHaveBeenCalled();
});
