// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordLearningNoteSchema } from "@blueprint/domain";
import { NotesPanel } from "./NotesPanel";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { runtime: transport } }));
const workspace = { blueprint: { schemaVersion: 2, id: "fd520000-0000-4000-8000-000000000001", version: 2, title: "私人路径", goals: [] }, records: [] };
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
test("notes open only on request and collapse preserves the shared workspace without extra reads or writes", async () => {
  await act(async () => root.render(<NotesPanel ownerId="owner-a" />));
  expect(transport.sendMessage).not.toHaveBeenCalled();
  await click("记录视频笔记");
  expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "LOAD_LEARNING_NOTES", ownerId: "owner-a" });
  const select = host.querySelector('[aria-label="笔记关联视频"]'); expect(select).not.toBeNull();
  await click("收起视频笔记");
  expect(host.querySelector<HTMLElement>('[aria-label="视频笔记"]')?.hidden).toBe(true);
  await click("记录视频笔记");
  expect(host.querySelector('[aria-label="笔记关联视频"]')).toBe(select);
  expect(transport.sendMessage).toHaveBeenCalledTimes(1);
});
test("failed notes reads offer retry without pretending history is empty", async () => {
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "unavailable" });
  await act(async () => root.render(<NotesPanel ownerId="owner-a" />)); await click("记录视频笔记");
  expect(host.textContent).toContain("不能据此判断历史为空"); expect(host.querySelector("textarea")).toBeNull();
  await click("重新读取视频笔记"); expect(host.querySelector("textarea")).not.toBeNull();
});
test("late notes reads from another account cannot mount its private workspace", async () => {
  let release!: (value: unknown) => void;
  transport.sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<NotesPanel ownerId="owner-a" />)); await click("记录视频笔记");
  await act(async () => root.render(<NotesPanel ownerId="owner-b" />));
  await act(async () => release({ ok: true, value: workspace }));
  expect(host.querySelector("textarea")).toBeNull();
  await click("记录视频笔记");
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "LOAD_LEARNING_NOTES", ownerId: "owner-b" });
});
test("revoked notes identity hides the previously loaded private workspace without retrying writes", async () => {
  await act(async () => root.render(<NotesPanel ownerId="owner-a" />)); await click("记录视频笔记");
  expect(host.querySelector("textarea")).not.toBeNull();
  transport.sendMessage.mockResolvedValueOnce({ ok: false, code: "forbidden" });
  await click("读取最新笔记");
  expect(host.textContent).toContain("私人笔记已隐藏"); expect(host.querySelector("textarea")).toBeNull();
  expect(transport.sendMessage.mock.calls.map(([message]) => message.type)).toEqual(["LOAD_LEARNING_NOTES", "LOAD_LEARNING_NOTES"]);
});
test("the real shared editor forwards explicit notes and only manually replays the same uncertain submission", async () => {
  const id = (n: number) => `fd520000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const value = { ...workspace, blueprint: { ...workspace.blueprint, goals: [{ id: id(2), title: "摄影", position: 0,
    stages: [{ id: id(3), title: "第一周", position: 0, nodes: [{ id: id(4), title: "观察光线", type: "learn", position: 0,
      dependencyIds: [], completionCriteria: "解释光线变化", estimatedMinutes: 30,
      resources: [{ id: id(5), kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] } };
  const sent: unknown[] = [];
  transport.sendMessage.mockImplementation(async message => {
    if (message.type === "LOAD_LEARNING_NOTES") return { ok: true, value };
    if (message.type === "READ_NOTE_POSITION") {
      expect(message).toEqual({ type: "READ_NOTE_POSITION", ownerId: "owner-a", input: { videoId: "abcdefghijk" } });
      return { ok: true, value: { videoId: "abcdefghijk", positionSeconds: 0 } };
    }
    expect(message).toMatchObject({ type: "SAVE_LEARNING_NOTE", ownerId: "owner-a" });
    sent.push(message.input); const command = recordLearningNoteSchema.parse(message.input);
    if (sent.length === 1) return { ok: false, code: "unavailable" };
    return { ok: true, value: { id: id(6), clientMutationId: command.clientMutationId, text: command.text, positionSeconds: command.positionSeconds,
      context: { blueprintId: workspace.blueprint.id, blueprintVersion: command.expectedVersion, goalId: id(2), goalTitle: "摄影", stageId: id(3), stageTitle: "第一周", nodeId: command.nodeId, nodeTitle: "观察光线", nodeType: "learn" },
      resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-10T00:00:00Z" } };
  });
  await act(async () => root.render(<NotesPanel ownerId="owner-a" />)); await click("记录视频笔记");
  for (const [label, text] of [["笔记关联视频", id(5)], ["笔记原文", "  保留原文\n😀  "], ["视频位置（秒，可选）", "0"]]) {
    const field = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, text);
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  }
  await click("读取当前播放位置"); expect(sent).toHaveLength(0);
  expect(transport.sendMessage).toHaveBeenLastCalledWith({ type: "READ_NOTE_POSITION", ownerId: "owner-a", input: { videoId: "abcdefghijk" } });
  await click("保存笔记"); expect(sent).toHaveLength(1);
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
  await click("收起视频笔记"); await click("记录视频笔记"); expect(sent).toHaveLength(1);
  await click("确认原笔记提交"); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]).toMatchObject({ text: "  保留原文\n😀  ", positionSeconds: 0, expectedVersion: 2, nodeId: id(4), resourceBindingId: id(5) });
  expect(host.textContent).toContain("笔记已保存");
  expect(transport.sendMessage.mock.calls.filter(([message]) => message.type === "LOAD_LEARNING_NOTES")).toHaveLength(1);
});
