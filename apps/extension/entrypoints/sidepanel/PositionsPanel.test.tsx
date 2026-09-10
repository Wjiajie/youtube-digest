// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordLearningPositionSchema } from "@blueprint/domain";
import { PositionsPanel } from "./PositionsPanel";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { runtime: transport } }));
const workspace = { blueprint: { schemaVersion: 2, id: "fd580000-0000-4000-8000-000000000001", version: 2, title: "私人路径", goals: [] }, records: [] };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); transport.sendMessage.mockReset();
  transport.sendMessage.mockResolvedValue({ ok: true, value: workspace });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_: string, __: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(navigator, "locks"); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
test("positions open explicitly and collapse preserves the shared workspace without extra reads or saves", async () => {
  await act(async () => root.render(<PositionsPanel ownerId="owner-a" />));
  expect(transport.sendMessage).not.toHaveBeenCalled();
  await click("继续学习");
  expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "LOAD_LEARNING_POSITIONS", ownerId: "owner-a" });
  const field = host.querySelector('[aria-label="继续学习关联视频"]'); expect(field).not.toBeNull();
  await click("收起继续学习");
  expect(host.querySelector<HTMLElement>('[aria-label="继续学习位置"]')?.hidden).toBe(true);
  await click("继续学习");
  expect(host.querySelector('[aria-label="继续学习关联视频"]')).toBe(field);
  expect(transport.sendMessage).toHaveBeenCalledTimes(1);
});
test("failed initial reads offer explicit retry without claiming an empty history", async () => {
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "unavailable" });
  await act(async () => root.render(<PositionsPanel ownerId="owner-a" />)); await click("继续学习");
  expect(host.textContent).toContain("不能据此判断历史为空"); expect(host.querySelector('[aria-label="继续学习关联视频"]')).toBeNull();
  await click("重新读取学习位置"); expect(host.querySelector('[aria-label="继续学习关联视频"]')).not.toBeNull();
});
test("late initial responses cannot expose the prior account's private positions", async () => {
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<PositionsPanel ownerId="owner-a" />)); await click("继续学习");
  await act(async () => root.render(<PositionsPanel ownerId="owner-b" />));
  await act(async () => release({ ok: true, value: workspace }));
  expect(host.querySelector('[aria-label="继续学习关联视频"]')).toBeNull();
  await click("继续学习");
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "LOAD_LEARNING_POSITIONS", ownerId: "owner-b" });
});
test("identity loss hides private positions instead of offering an untrusted empty workspace", async () => {
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "forbidden" });
  await act(async () => root.render(<PositionsPanel ownerId="owner-a" />)); await click("继续学习");
  expect(host.textContent).toContain("私人学习位置已隐藏");
  expect(host.querySelector('[aria-label="继续学习关联视频"]')).toBeNull();
});
test("shared editor filters the selected binding, captures without saving and explicitly recovers the same uncertain position", async () => {
  const id = (n: number) => `fd580000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const value = { ...workspace, blueprint: { ...workspace.blueprint, goals: [{ id: id(2), title: "摄影", position: 0,
    stages: [{ id: id(3), title: "第一周", position: 0, nodes: [{ id: id(4), title: "观察光线", type: "learn", position: 0,
      dependencyIds: [], completionCriteria: "解释光线变化", estimatedMinutes: 30,
      resources: [{ id: id(5), kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] } };
  const sent: unknown[] = [];
  transport.sendMessage.mockImplementation(async message => {
    if (message.type === "LOAD_LEARNING_POSITIONS") return { ok: true, value };
    if (message.type === "READ_LEARNING_POSITION") return { ok: true, value: { videoId: "abcdefghijk", positionSeconds: 0 } };
    expect(message).toMatchObject({ type: "SAVE_LEARNING_POSITION", ownerId: "owner-a" });
    sent.push(message.input); const command = recordLearningPositionSchema.parse(message.input);
    if (sent.length === 1) return { ok: false, code: "unavailable" };
    return { ok: true, value: { id: id(6), clientMutationId: command.clientMutationId, positionSeconds: command.positionSeconds,
      expectedPositionVersion: command.expectedPositionVersion, positionVersion: command.expectedPositionVersion + 1,
      context: { blueprintId: workspace.blueprint.id, blueprintVersion: command.expectedVersion, goalId: id(2), goalTitle: "摄影", stageId: id(3), stageTitle: "第一周", nodeId: command.nodeId, nodeTitle: "观察光线", nodeType: "learn" },
      resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-11T00:00:00Z" } };
  });
  await act(async () => root.render(<PositionsPanel ownerId="owner-a" />)); await click("继续学习");
  const select = host.querySelector<HTMLSelectElement>('[aria-label="继续学习关联视频"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, id(5)); select.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("读取所选视频位置");
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "LOAD_LEARNING_POSITIONS", ownerId: "owner-a", resourceBindingId: id(5) });
  await click("使用此来源与最新位置版本"); await click("读取当前播放位置");
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "READ_LEARNING_POSITION", ownerId: "owner-a", input: { videoId: "abcdefghijk" } });
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.value).toBe("0"); expect(sent).toEqual([]);
  await click("保存继续学习位置"); expect(sent).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('[aria-label="继续学习位置（秒）"]')!.disabled).toBe(true);
  await click("收起继续学习"); await click("继续学习"); expect(sent).toHaveLength(1);
  await click("确认原位置提交"); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]).toMatchObject({ positionSeconds: 0, expectedVersion: 2, expectedPositionVersion: 0, nodeId: id(4), resourceBindingId: id(5) });
  expect(host.textContent).toContain("位置已保存");
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "forbidden" });
  await click("读取所选视频位置");
  expect(host.textContent).toContain("私人学习位置已隐藏");
  expect(host.querySelector('[aria-label="继续学习关联视频"]')).toBeNull();
});
