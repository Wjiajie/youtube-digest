// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StatusPanel } from "./StatusPanel";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { runtime: transport } }));
const workspace = { blueprint: { schemaVersion: 2, id: "fd470000-0000-4000-8000-000000000001", version: 2, title: "私人路径", goals: [] },
  current: [], history: [], evidence: { ok: true, value: [] } };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); transport.sendMessage.mockReset();
  transport.sendMessage.mockResolvedValue({ ok: true, value: workspace });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
test("assessment opens only on request and collapse preserves the shared workspace without extra reads or writes", async () => {
  await act(async () => root.render(<StatusPanel ownerId="owner-a" />));
  expect(transport.sendMessage).not.toHaveBeenCalled();
  await click("核对节点状态");
  expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "LOAD_NODE_STATUS", ownerId: "owner-a" });
  expect(host.textContent).toContain("由你确认下一步");
  const select = host.querySelector('select[aria-label="路径节点"]');
  await click("收起节点状态");
  expect(host.querySelector<HTMLElement>('[aria-label="节点状态确认"]')?.hidden).toBe(true);
  await click("核对节点状态");
  expect(host.querySelector('select[aria-label="路径节点"]')).toBe(select);
  expect(transport.sendMessage).toHaveBeenCalledTimes(1);
});
test("failed assessment reads offer retry without pretending that history is empty", async () => {
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "unavailable" });
  await act(async () => root.render(<StatusPanel ownerId="owner-a" />));
  await click("核对节点状态");
  expect(host.textContent).toContain("暂时无法读取节点状态");
  expect(host.textContent).not.toContain("尚无状态确认历史");
  await click("重新读取节点状态");
  expect(host.textContent).toContain("由你确认下一步");
});
test("late assessment reads from another account cannot mount its private workspace", async () => {
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<StatusPanel ownerId="owner-a" />));
  await click("核对节点状态");
  await act(async () => root.render(<StatusPanel ownerId="owner-b" />));
  await act(async () => release({ ok: true, value: workspace }));
  expect(host.textContent).not.toContain("由你确认下一步");
  await click("核对节点状态");
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "LOAD_NODE_STATUS", ownerId: "owner-b" });
});
