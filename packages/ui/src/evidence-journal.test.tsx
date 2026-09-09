// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ApplicationResult, BlueprintSnapshot, ProgressEvidence } from "@blueprint/domain";
import { ThemeSurface } from "@blueprint/ui/theme";
import { EvidenceJournal } from "@blueprint/ui/evidence-journal";

const accountId = "a5000000-0000-4000-8000-000000000001";
const nodeId = "a5000000-0000-4000-8000-000000000030";
const blueprint: BlueprintSnapshot = {
  schemaVersion: 1, id: "a5000000-0000-4000-8000-000000000005", version: 2, title: "我的成长路径",
  goals: [{ id: "a5000000-0000-4000-8000-000000000010", title: "演讲能力", position: 0, stages: [{
    id: "a5000000-0000-4000-8000-000000000020", title: "第一周", position: 0,
    nodes: [{ id: nodeId, type: "practice", title: "录制三分钟演讲", position: 0, dependencyIds: [], resources: [] }],
  }] }],
};
let host: HTMLDivElement, root: Root;
let saveAction: (value: unknown) => Promise<ApplicationResult<ProgressEvidence>>;
let reloadAction: () => Promise<ApplicationResult<{ blueprint: BlueprintSnapshot; records: ApplicationResult<ProgressEvidence[]> }>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const held = new Set<string>();
  // Browser API boundary, not a private application collaborator.
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void> | void) => {
      await Promise.resolve();
      if (held.has(name)) return callback(null);
      held.add(name);
      try { await callback({ name }); } finally { held.delete(name); }
    },
  } });
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  saveAction = async () => ({ ok: false, code: "unavailable" });
  reloadAction = async () => ({ ok: true, value: { blueprint, records: { ok: true, value: [] } } });
});

test("requires explicit current-path confirmation after a version conflict while keeping the written outcome", async () => {
  saveAction = async () => ({ ok: false, code: "version_conflict" });
  reloadAction = async () => ({ ok: true, value: { blueprint: { ...blueprint, version: 3 }, records: { ok: true, value: [] } } });
  await render(); await writeDraft();
  await act(async () => button("保存私人记录").click());
  expect(host.querySelector("textarea")?.readOnly).toBe(false);
  await act(async () => button("读取当前路径与记录").click());
  expect(button("保存私人记录").disabled).toBe(true);
  expect(host.querySelector("textarea")?.value).toBe("完成了第一次录制，发现语速太快。");
  await act(async () => button("确认使用当前路径（版本 3）").click());
  expect(button("保存私人记录").disabled).toBe(false);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(navigator, "locks"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(account = accountId, theme: "cyberpunk" | "eastern" = "cyberpunk", source = blueprint) {
  await act(async () => root.render(<ThemeSurface theme={theme}><EvidenceJournal accountId={account}
    initial={{ blueprint: source, records: { ok: true, value: [] } }} saveAction={saveAction} reloadAction={reloadAction} /></ThemeSurface>));
}
function button(text: string) { return [...host.querySelectorAll("button")].find((item) => item.textContent === text)!; }
async function field(label: string, value: string) {
  const element = host.querySelector<HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function writeDraft() { await field("关联路径节点", nodeId); await field("这次的收获", "完成了第一次录制，发现语速太快。"); }
function receipt(clientMutationId: string): ProgressEvidence {
  return {
    id: "a5000000-0000-4000-8000-000000000050", clientMutationId,
    context: { blueprintId: blueprint.id, blueprintVersion: 2, goalId: blueprint.goals[0]!.id, goalTitle: "演讲能力",
      stageId: blueprint.goals[0]!.stages[0]!.id, stageTitle: "第一周", nodeId, nodeTitle: "录制三分钟演讲", nodeType: "practice" },
    text: "完成了第一次录制，发现语速太快。", artifactUrl: null, createdAt: "2026-09-10T01:00:00Z",
  };
}

test("preserves a private outcome draft across reloads and theme changes, isolated by account", async () => {
  await render(); await writeDraft();
  const text = host.querySelector("textarea")!;
  text.focus(); text.setSelectionRange(2, 5);
  await render(accountId, "eastern");
  expect(host.querySelector("textarea")).toBe(text);
  expect([text.selectionStart, text.selectionEnd]).toEqual([2, 5]);
  await render("a5000000-0000-4000-8000-000000000002");
  expect(host.querySelector("textarea")?.value).toBe("");
  await render();
  expect(host.querySelector("textarea")?.value).toBe("完成了第一次录制，发现语速太快。");
  expect(host.querySelector("select")?.value).toBe(nodeId);
  expect(host.textContent).toContain("仅自己可见");
});

test("preserves an uncertain submission across reload and retries the original receipt without creating another record", async () => {
  const attempts: unknown[] = [];
  saveAction = async (value) => { attempts.push(value); throw new Error("response lost after commit"); };
  await render(); await writeDraft();
  await act(async () => button("保存私人记录").click());
  expect(host.textContent).toContain("尚不能确认是否保存");
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
  await render("a5000000-0000-4000-8000-000000000002");
  saveAction = async (value) => {
    attempts.push(value);
    return { ok: true, value: receipt((value as { clientMutationId: string }).clientMutationId) };
  };
  await render();
  await act(async () => button("确认原提交结果").click());
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(host.textContent).toContain("记录已保存");
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(host.textContent).toContain("完成了第一次录制，发现语速太快。");
});

test("does not overwrite an unreadable recovery draft with an empty form", async () => {
  const key = `blueprint-evidence-draft:${accountId}:${blueprint.id}`;
  localStorage.setItem(key, "{无法解析，但这段文字需要保留");
  await render();
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="无法识别的草稿"]')?.value).toContain("文字需要保留");
  expect(host.querySelector('[aria-label="这次的收获"]')).toBeNull();
  expect(localStorage.getItem(key)).toBe("{无法解析，但这段文字需要保留");
});

test("prevents duplicate submits and ignores a late receipt after switching accounts", async () => {
  let finish!: (value: ApplicationResult<ProgressEvidence>) => void;
  let mutation = ""; let calls = 0;
  saveAction = async (value) => { calls++; mutation = (value as { clientMutationId: string }).clientMutationId; return new Promise((resolve) => { finish = resolve; }); };
  await render(); await writeDraft();
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(calls).toBe(1);
  await render("a5000000-0000-4000-8000-000000000002");
  await act(async () => finish({ ok: true, value: receipt(mutation) }));
  expect(host.textContent).not.toContain("完成了第一次录制，发现语速太快。");
  expect(host.querySelector("textarea")?.value).toBe("");
  await render();
  expect(button("确认原提交结果")).toBeDefined();
});

test("keeps rejected text editable and never submits malformed external links", async () => {
  let calls = 0;
  saveAction = async () => { calls++; return { ok: false, code: "invalid" }; };
  await render(); await writeDraft(); await field("作品链接", "javascript:alert(1)");
  await act(async () => button("保存私人记录").click());
  expect(calls).toBe(0);
  await field("作品链接", "");
  await act(async () => button("保存私人记录").click());
  expect(calls).toBe(1);
  expect(host.querySelector("textarea")?.readOnly).toBe(false);
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  expect(host.textContent).toContain("记录未被接受");
});

test("retains an archived node draft and requires selecting a valid replacement", async () => {
  await render(); await writeDraft();
  reloadAction = async () => ({ ok: true, value: { blueprint: { ...blueprint, version: 3, goals: [] }, records: { ok: true, value: [] } } });
  await render(); await act(async () => button("读取当前路径与记录").click());
  expect(host.textContent).toContain("录制三分钟演讲（已不在当前路径）");
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  expect(button("确认使用当前路径（版本 3）").disabled).toBe(true);
  expect(button("保存私人记录").disabled).toBe(true);
});

test("hides private content on an account authorization change without deleting its recovery", async () => {
  saveAction = async () => ({ ok: false, code: "forbidden" });
  await render(); await writeDraft();
  await act(async () => button("保存私人记录").click());
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("原账号草稿仍保留");
  expect(localStorage.getItem(`blueprint-evidence-draft:${accountId}:${blueprint.id}`)).toContain("第一次录制");
});

test("does not lose in-page writing when browser storage refuses a write", async () => {
  await render();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
  await writeDraft();
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  expect(host.textContent).toContain("浏览器无法保存恢复草稿");
});

test("does not send an outcome until its exact retry identity can survive a reload", async () => {
  let submissions = 0;
  saveAction = async (value) => { submissions++; return { ok: true, value: receipt((value as { clientMutationId: string }).clientMutationId) }; };
  await render(); await writeDraft();
  const write = Storage.prototype.setItem;
  const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (JSON.parse(value).attempt) throw new DOMException("quota", "QuotaExceededError");
    write.call(this, key, value);
  });
  await act(async () => button("保存私人记录").click());
  expect(submissions).toBe(0);
  expect(host.textContent).toContain("尚未发送");
  expect(host.querySelector("textarea")?.readOnly).toBe(false);
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  await render("a5000000-0000-4000-8000-000000000002");
  quota.mockRestore();
  await render();
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  await act(async () => button("保存私人记录").click());
  expect(submissions).toBe(1);
  expect(host.textContent).toContain("记录已保存");
});

test("does not replace an unread draft after a transient storage read failure", async () => {
  await render(); await writeDraft();
  await render("a5000000-0000-4000-8000-000000000002");
  vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new DOMException("temporarily denied", "SecurityError"); });
  await render();
  expect(host.querySelector('[aria-label="这次的收获"]')).toBeNull();
  expect(host.textContent).toContain("原数据不会自动删除");
  await act(async () => button("重新读取本机草稿").click());
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  expect(host.querySelector("textarea")?.readOnly).toBe(false);
  expect(host.textContent).not.toContain("无法读取本机恢复草稿");
});

test("renders historical content as text and links only safe HTTPS artifacts", async () => {
  const safe = { ...receipt("a5000000-0000-4000-8000-000000000060"), artifactUrl: "https://example.test/work", text: "<script>not HTML</script>" };
  const unsafe = { ...safe, id: "a5000000-0000-4000-8000-000000000051", artifactUrl: "javascript:alert(1)" };
  await act(async () => root.render(<EvidenceJournal accountId={accountId} initial={{ blueprint, records: { ok: true, value: [safe, unsafe] } }} saveAction={saveAction} reloadAction={reloadAction} />));
  expect(host.querySelector("script")).toBeNull();
  const links = host.querySelectorAll("article a");
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(links[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(host.textContent).toContain("javascript:alert(1)");
});

test("distinguishes unavailable history from no records and preserves the draft on refresh failure", async () => {
  reloadAction = async () => { throw new Error("offline"); };
  await act(async () => root.render(<EvidenceJournal accountId={accountId} initial={{ blueprint, records: { ok: false, code: "unavailable" } }} saveAction={saveAction} reloadAction={reloadAction} />));
  await writeDraft();
  expect(host.textContent).toContain("这不表示记录为空");
  expect(host.textContent).not.toContain("还没有成果记录");
  await act(async () => button("读取当前路径与记录").click());
  expect(host.querySelector("textarea")?.value).toContain("第一次录制");
  expect(host.textContent).toContain("暂时无法读取。现有记录与草稿仍保留");
});

test("does not leave an old saved confirmation beside a newly edited draft", async () => {
  saveAction = async (value) => ({ ok: true, value: receipt((value as { clientMutationId: string }).clientMutationId) });
  await render(); await writeDraft();
  await act(async () => button("保存私人记录").click());
  expect(host.textContent).toContain("记录已保存");
  await field("这次的收获", "这段是新的未保存草稿");
  expect(host.textContent).not.toContain("记录已保存");
  expect(host.textContent).toContain("当前文字尚未保存到云端");
});

test("does not let a second tab overwrite the active private draft and can take over after it closes", async () => {
  await render(); await writeDraft();
  const secondHost = document.createElement("div"), secondRoot = createRoot(secondHost);
  document.body.append(secondHost);
  try {
    await act(async () => secondRoot.render(<EvidenceJournal accountId={accountId} initial={{ blueprint, records: { ok: true, value: [] } }} saveAction={saveAction} reloadAction={reloadAction} />));
    expect(secondHost.textContent).toContain("另一标签页正在编辑");
    expect(secondHost.querySelector("textarea")?.readOnly).toBe(true);
    await act(async () => root.render(null));
    await act(async () => [...secondHost.querySelectorAll("button")].find((entry) => entry.textContent === "重新尝试编辑")!.click());
    expect(secondHost.querySelector("textarea")?.readOnly).toBe(false);
    expect(secondHost.querySelector("textarea")?.value).toContain("第一次录制");
  } finally { await act(async () => secondRoot.unmount()); secondHost.remove(); }
});

test("handles Strict Mode lock cleanup and does not permit editing without safe browser locking", async () => {
  await act(async () => root.render(<StrictMode><EvidenceJournal accountId={accountId} initial={{ blueprint, records: { ok: true, value: [] } }} saveAction={saveAction} reloadAction={reloadAction} /></StrictMode>));
  expect(host.querySelector("textarea")?.readOnly).toBe(false);
  await act(async () => root.render(null));
  Reflect.deleteProperty(navigator, "locks");
  await render();
  expect(host.querySelector("textarea")?.readOnly).toBe(true);
  expect(host.textContent).toContain("浏览器无法提供安全的草稿编辑锁");
});
