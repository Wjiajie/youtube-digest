// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordLearningNoteSchema, type ApplicationResult, type LearningNote, type LearningNoteWorkspace } from "@blueprint/domain";
import { ThemeSurface } from "./theme";
import { NotesWorkspace } from "./learning-notes";

const id = (n: number) => `fd520000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), binding = id(6), storageKey = `blueprint-learning-note:v1:${owner}:${id(2)}`;
const initial: LearningNoteWorkspace = { blueprint: { schemaVersion: 2, id: id(2), version: 1, title: "摄影路径", goals: [{
  id: id(3), title: "记录光线", position: 0, stages: [{ id: id(4), title: "第一周", position: 0, nodes: [{ id: id(5), title: "观察曝光",
    type: "learn", position: 0, estimatedMinutes: 30, completionCriteria: "解释曝光变化", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] }, records: [] };
let host: HTMLDivElement, root: Root, workspace: LearningNoteWorkspace;
let save: (input: unknown) => Promise<ApplicationResult<LearningNote>>, read: () => Promise<ApplicationResult<LearningNoteWorkspace>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); workspace = structuredClone(initial);
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (key: string, _: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (held.has(key)) return callback(null); held.add(key); try { await callback({}); } finally { held.delete(key); }
  } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save = async input => {
    const command = recordLearningNoteSchema.parse(input);
    const previous = workspace.records.find(note => note.clientMutationId === command.clientMutationId);
    const value: LearningNote = previous ?? { id: crypto.randomUUID(), clientMutationId: command.clientMutationId, text: command.text, positionSeconds: command.positionSeconds,
      context: { blueprintId: id(2), blueprintVersion: command.expectedVersion, goalId: id(3), goalTitle: "记录光线", stageId: id(4), stageTitle: "第一周",
        nodeId: command.nodeId, nodeTitle: "观察曝光", nodeType: "learn" }, resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-10T00:00:00Z" };
    if (!previous) workspace.records.unshift(value);
    return { ok: true, value };
  };
  read = async () => ({ ok: true, value: structuredClone(workspace) });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(navigator, "locks"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(accountId = owner, theme: "cyberpunk" | "eastern" = "cyberpunk") {
  await act(async () => root.render(<ThemeSurface theme={theme}><NotesWorkspace accountId={accountId} initial={workspace} saveAction={save} reloadAction={read} /></ThemeSurface>));
}
function button(label: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === label)!; }
async function fill(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  expect(field).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function compose() { await fill("笔记关联视频", binding); await fill("笔记原文", "  从光线开始。\n保留疑问。  "); await fill("视频位置（秒，可选）", "0"); }

test("explicitly chosen video saves verbatim text and zero location, not a mastery or viewing claim", async () => {
  await render(); expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("");
  await compose(); await act(async () => button("保存笔记").click());
  expect(workspace.records).toHaveLength(1); expect(workspace.records[0]).toMatchObject({ text: "  从光线开始。\n保留疑问。  ", positionSeconds: 0, resource: { bindingId: binding } });
  expect(host.textContent).toContain("笔记已保存");
  expect(host.querySelector<HTMLAnchorElement>('.note-history a[target="_blank"]')?.href).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=0s");
});

test("a lost response restores the immutable original submission across remount and theme without sending automatically", async () => {
  const accept = save, sent: unknown[] = [];
  save = async input => { sent.push(input); const result = await accept(input); return sent.length === 1 ? { ok: false, code: "unavailable" } : result; };
  await render(); await compose(); await act(async () => button("保存笔记").click());
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="笔记原文"]')!.disabled).toBe(true);
  await act(async () => root.unmount()); root = createRoot(host); await render(owner, "eastern");
  expect(sent).toHaveLength(1); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="笔记原文"]')!.value).toBe("  从光线开始。\n保留疑问。  ");
  await act(async () => button("确认原笔记提交").click());
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(workspace.records).toHaveLength(1);
  expect(host.textContent).toContain("笔记已保存"); expect(localStorage.getItem(storageKey)).not.toContain("clientMutationId");
});

test("another editor is read-only and explicit takeover reads the current path before any new save", async () => {
  await render(); await compose();
  const otherHost = document.createElement("div"), other = createRoot(otherHost); document.body.append(otherHost);
  try {
    await act(async () => other.render(<NotesWorkspace accountId={owner} initial={initial} saveAction={save} reloadAction={read} />));
    expect(otherHost.textContent).toContain("另一标签页");
    expect(otherHost.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    await act(async () => root.unmount()); root = createRoot(host); workspace.blueprint.version = 2;
    await act(async () => [...otherHost.querySelectorAll("button")].find(item => item.textContent === "重新尝试编辑笔记")!.click());
    expect(otherHost.textContent).toContain("当前路径版本 2");
    expect([...otherHost.querySelectorAll("button")].find(item => item.textContent === "保存笔记")!.disabled).toBe(true);
  } finally { await act(async () => other.unmount()); otherHost.remove(); }
});

test("a definitive conflict keeps original text and requires reading and explicit source rebind before a fresh submission", async () => {
  const accept = save; save = async () => ({ ok: false, code: "version_conflict" });
  await render(); await compose(); await act(async () => button("保存笔记").click());
  expect(button("保存笔记").disabled).toBe(true);
  workspace.blueprint.version = 2;
  await act(async () => button("读取最新笔记").click());
  await act(async () => button("按当前路径重新关联").click());
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("  从光线开始。\n保留疑问。  ");
  save = accept; await render(); await act(async () => button("保存笔记").click());
  expect(workspace.records[0]?.context.blueprintVersion).toBe(2);
});

test("corrupt recovery stays copyable and unchanged until the user explicitly acknowledges reset", async () => {
  localStorage.setItem(storageKey, "{keep my private note"); await render();
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="原始笔记恢复内容"]')?.value).toBe("{keep my private note");
  expect(button("保存笔记").disabled).toBe(true); expect(localStorage.getItem(storageKey)).toBe("{keep my private note");
  await act(async () => button("已另行保存原文，重置笔记草稿").click());
  await compose(); await act(async () => button("保存笔记").click()); expect(workspace.records).toHaveLength(1);
});

test("unavailable storage never sends an unrecorded attempt and retains text typed in this editor", async () => {
  let sent = false; save = async () => { sent = true; return { ok: false, code: "unavailable" }; };
  await render(); await compose(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await fill("笔记原文", "无法落盘，但不能丢失这句话"); await act(async () => button("保存笔记").click());
  expect(sent).toBe(false); expect(host.textContent).toContain("尚未发送");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("无法落盘，但不能丢失这句话");
});

test("identity loss hides private state but preserves the account's pending request", async () => {
  save = async () => ({ ok: false, code: "unauthenticated" }); await render(); await compose();
  await act(async () => button("保存笔记").click()); expect(host.textContent).toContain("账号或登录状态已变化");
  expect(host.textContent).not.toContain("观察曝光"); expect(localStorage.getItem(storageKey)).toContain("clientMutationId");
  await render(id(10)); expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
});

test("historical receipt recovery survives source removal and does not bind its original text to a new video", async () => {
  const accept = save; let receipt: ApplicationResult<LearningNote>;
  save = async input => { receipt = await accept(input); return { ok: false, code: "unavailable" }; };
  await render(); await compose(); await act(async () => button("保存笔记").click());
  workspace.blueprint = { ...workspace.blueprint, version: 2, goals: [] };
  await act(async () => button("读取最新笔记").click());
  expect(host.textContent).toContain("原来源不可用"); expect(host.textContent).toContain("观察曝光");
  save = async () => receipt!; await render(); await act(async () => button("确认原笔记提交").click());
  expect(host.textContent).toContain("笔记已保存"); expect(host.querySelectorAll(".note-history .bp-panel")).toHaveLength(1);
  expect(host.textContent).toContain("保存时路径版本 1"); expect(button("保存笔记").disabled).toBe(true);
});

test("receipt cleanup failure keeps a recoverable request without falsely reporting an unsent operation", async () => {
  const accept = save; save = async input => { const result = await accept(input); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); return result; };
  await render(); await compose(); await act(async () => button("保存笔记").click());
  expect(host.textContent).toContain("云端笔记已保存"); expect(host.textContent).not.toContain("尚未发送");
  expect(button("确认原笔记提交").disabled).toBe(false); expect(localStorage.getItem(storageKey)).toContain("clientMutationId");
});

test("malformed receipts preserve the original attempt and never announce success", async () => {
  const accept = save; save = async input => { const result = await accept(input); return result.ok ? { ok: true, value: { ...result.value, text: "not original" } } : result; };
  await render(); await compose(); await act(async () => button("保存笔记").click());
  expect(host.textContent).not.toContain("笔记已保存"); expect(button("确认原笔记提交").disabled).toBe(false);
});

test("a missing editor lock or unreadable storage cannot silently authorize editing", async () => {
  Reflect.deleteProperty(navigator, "locks"); await render(); expect(host.textContent).toContain("仅可查看");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
});

test("recovering an older receipt does not promote it above newer history", async () => {
  const accept = save; let receipt: ApplicationResult<LearningNote>;
  save = async input => { receipt = await accept(input); return { ok: false, code: "unavailable" }; };
  await render(); await compose(); await act(async () => button("保存笔记").click());
  workspace.records.unshift({ ...workspace.records[0]!, id: id(20), clientMutationId: id(21), text: "更新的另一条笔记", createdAt: "2026-09-11T00:00:00Z" });
  await act(async () => button("读取最新笔记").click()); save = async () => receipt!; await render();
  await act(async () => button("确认原笔记提交").click());
  expect(host.querySelector(".note-history .note-text")?.textContent).toBe("更新的另一条笔记");
});
