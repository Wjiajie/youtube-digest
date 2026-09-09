// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AccountPreferences, ApplicationResult, BlueprintSnapshot } from "@blueprint/domain";

import { AccountTheme } from "./account-theme";
import { BlueprintEditor } from "./blueprint-editor";

const initial: AccountPreferences = { theme: { id: "cyberpunk", version: 1 }, revision: 3 };
const blueprint: BlueprintSnapshot = {
  schemaVersion: 1, id: "018f6f68-9b4d-7c93-a134-c8571b8f7701", version: 1, title: "我的蓝图", goals: [],
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  localStorage.setItem(`blueprint-draft:${blueprint.id}`, JSON.stringify({
    baseVersion: 1, draft: { ...blueprint, title: "未提交的学习路径" }, resourceUrls: {},
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function chooseEastern() {
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "eastern";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(text: string) {
  return [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
}

test("previewing and saving a theme preserves the real editor and only claims a save after confirmation", async () => {
  let confirmSave!: (value: ApplicationResult<AccountPreferences>) => void;
  await act(async () => root.render(<AccountTheme
    initial={{ ok: true, value: initial }}
    readAction={async () => ({ ok: true, value: initial })}
    saveAction={async () => new Promise((resolve) => { confirmSave = resolve; })}
  ><BlueprintEditor initial={blueprint} sessions={[]} /></AccountTheme>));
  const input = host.querySelector("input")!;
  input.focus(); input.setSelectionRange(1, 4);
  await chooseEastern();
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("未提交的学习路径");
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
  expect(document.activeElement).toBe(input);
  expect(host.textContent).not.toContain("主题已保存到账号");
  await act(async () => button("保存到账号").click());
  expect(host.textContent).toContain("正在保存主题");
  await act(async () => confirmSave({ ok: true, value: { theme: { id: "eastern", version: 1 }, revision: 4 } }));
  expect(host.textContent).toContain("主题已保存到账号");
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("未提交的学习路径");
});

test("returning to the page follows a newer account theme without replacing the editor", async () => {
  await act(async () => root.render(<AccountTheme initial={{ ok: true, value: initial }}
    readAction={async () => ({ ok: true, value: { theme: { id: "eastern", version: 1 }, revision: 4 } })}
    saveAction={async () => ({ ok: false, code: "unavailable" })}
  ><BlueprintEditor initial={blueprint} sessions={[]} /></AccountTheme>));
  const input = host.querySelector("input")!;
  input.focus(); input.setSelectionRange(1, 3);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("未提交的学习路径");
  expect(document.activeElement).toBe(input);
});

test("a failed save keeps the preview and editor recoverable without claiming synchronization", async () => {
  await act(async () => root.render(<AccountTheme initial={{ ok: true, value: initial }}
    readAction={async () => ({ ok: true, value: initial })}
    saveAction={async () => { throw new Error("offline"); }}
  ><BlueprintEditor initial={blueprint} sessions={[]} /></AccountTheme>));
  await chooseEastern();
  await act(async () => button("保存到账号").click());
  expect(host.textContent).toContain("暂时无法同步账号主题");
  expect(host.textContent).not.toContain("主题已保存到账号");
  expect(host.querySelector("[data-bp-theme]")?.getAttribute("data-bp-theme")).toBe("eastern");
  expect(host.querySelector("input")?.value).toBe("未提交的学习路径");
  expect(button("保存到账号").disabled).toBe(false);
});

test("a newer remote choice never silently replaces an unsaved preview", async () => {
  await act(async () => root.render(<AccountTheme initial={{ ok: true, value: initial }}
    readAction={async () => ({ ok: true, value: { theme: { id: "cyberpunk", version: 1 }, revision: 5 } })}
    saveAction={async () => ({ ok: false, code: "version_conflict" })}
  ><BlueprintEditor initial={blueprint} sessions={[]} /></AccountTheme>));
  const input = host.querySelector("input")!;
  await chooseEastern();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toContain("账号主题已在别处更改");
  expect(host.querySelector("select")?.value).toBe("eastern");
  expect(button("保存到账号").disabled).toBe(true);
  await act(async () => button("读取账号主题").click());
  expect(host.querySelector("select")?.value).toBe("cyberpunk");
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("未提交的学习路径");
});

test("an account change hides the old account view and does not offer further preference writes", async () => {
  await act(async () => root.render(<AccountTheme initial={{ ok: true, value: initial }}
    readAction={async () => ({ ok: false, code: "forbidden" })}
    saveAction={async () => ({ ok: false, code: "forbidden" })}
  ><BlueprintEditor initial={blueprint} sessions={[]} /></AccountTheme>));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toContain("登录状态或账号已变化");
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  expect(localStorage.getItem(`blueprint-draft:${blueprint.id}`)).toContain("未提交的学习路径");
});

test("a future saved theme explains its temporary fallback without rewriting the account", async () => {
  await act(async () => root.render(<AccountTheme
    initial={{ ok: true, value: { theme: { id: "future-world", version: 2 }, revision: 9 } }}
    readAction={async () => ({ ok: false, code: "unavailable" })}
    saveAction={async () => { throw new Error("reading a future theme must not write it"); }}
  ><div>我的目标</div></AccountTheme>));
  expect(host.querySelector("select")?.value).toBe("cyberpunk");
  expect(button("保存到账号").disabled).toBe(true);
  expect(host.textContent).toContain("当前版本暂不支持账号保存的主题");
});
