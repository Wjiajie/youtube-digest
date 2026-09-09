// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PublicPreview } from "./public-preview";

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<PublicPreview />)); }
function button(name: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === name)!; }
async function theme(value: string) {
  const select = host.querySelector("select")!;
  await act(async () => { select.focus(); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  return select;
}

test("visitors can expand four actionable example nodes and change themes without losing expansion or keyboard focus", async () => {
  await render();
  expect(host.textContent).toContain("准备清晰的五分钟公开表达");
  const expand = button("展开完整示例路径"); expect(expand.getAttribute("aria-expanded")).toBe("false");
  const path = host.querySelector<HTMLElement>(`#${expand.getAttribute("aria-controls")}`)!;
  expect(path.hidden).toBe(true);
  await act(async () => expand.click());
  expect(path.hidden).toBe(false); expect(path.querySelectorAll("article")).toHaveLength(4);
  for (const label of ["学习", "实践", "检查点", "复盘"]) expect(path.textContent).toContain(label);
  for (const article of path.querySelectorAll("article")) {
    expect(article.textContent).toContain("完成依据"); expect(article.textContent).toContain("分钟"); expect(article.textContent).toContain("示例成果");
  }
  const picker = await theme("eastern");
  expect(host.querySelector('[data-bp-theme="eastern"]')).not.toBeNull();
  expect(path.isConnected).toBe(true); expect(path.hidden).toBe(false); expect(document.activeElement).toBe(picker);
  await theme("cyberpunk"); expect(path.hidden).toBe(false);
  await act(async () => button("收起示例路径").click()); expect(path.hidden).toBe(true);
});

test("the public introduction offers only the approved login destinations and distinguishes shipped tools from future aspirations", async () => {
  await render();
  expect([...host.querySelectorAll("a")].map(link => [link.textContent, link.getAttribute("href")])).toEqual([
    ["跳过示例，登录", "/login"], ["建立我的目标", "/login?next=%2Fgoals%2Fnew"],
  ]);
  expect(host.textContent).toContain("受邀账号"); expect(host.textContent).toContain("不开放自助注册");
  expect(host.querySelector('[aria-label="当前可用能力"]')?.textContent).toContain("审阅路径");
  const future = host.querySelector('[aria-label="后续愿景"]')!;
  for (const text of ["尚未接通", "Agent Skills", "自动推荐", "字幕工作台", "正式 3D"]) expect(future.textContent).toContain(text);
  expect(host.querySelector('[aria-label="示例身份静态回退"]')?.textContent).toContain("正式 3D 未完成");
  expect(host.textContent).toContain("不是保证有效的完整课程");
  expect(host.textContent).toContain("不会改变账号主题");
  expect(host.textContent).toContain("预先编写"); expect(host.textContent).not.toContain("人工编写");
});

test("reading and changing the example never touches network, browser storage, or personal inputs", async () => {
  const network = vi.fn(() => { throw new Error("preview must not request a network"); }); vi.stubGlobal("fetch", network);
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("private storage is unavailable"); });
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("must not store preview data"); });
  const removals = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("must not delete private data"); });
  await render(); await act(async () => button("展开完整示例路径").click()); await theme("eastern");
  expect(network).not.toHaveBeenCalled(); expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(removals).not.toHaveBeenCalled();
  expect(host.querySelectorAll("form, input, textarea")).toHaveLength(0);
  expect([...host.querySelectorAll("button")].map(item => item.textContent)).toEqual(["收起示例路径"]);
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector('[data-bp-theme="cyberpunk"]')).not.toBeNull();
  expect(button("展开完整示例路径").getAttribute("aria-expanded")).toBe("false");
});
