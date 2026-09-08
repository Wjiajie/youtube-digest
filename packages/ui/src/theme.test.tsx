// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveTheme, ThemeSurface } from "./theme";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("switching presentation preserves an unsubmitted note, focus and confirmation state", async () => {
  const content = <form><label>私人记录<textarea defaultValue="" /></label><label><input type="checkbox" />确认提交</label></form>;
  await act(async () => root.render(<ThemeSurface theme="cyberpunk">{content}</ThemeSurface>));
  const note = host.querySelector("textarea")!;
  const confirmation = host.querySelector("input")!;
  note.value = "本周已经做出第一版作品，还未提交。";
  confirmation.checked = true;
  note.focus();
  await act(async () => root.render(<ThemeSurface theme="eastern">{content}</ThemeSurface>));
  expect(host.firstElementChild?.getAttribute("data-bp-theme")).toBe("eastern");
  expect(host.querySelector("textarea")).toBe(note);
  expect(note.value).toBe("本周已经做出第一版作品，还未提交。");
  expect(document.activeElement).toBe(note);
  expect(confirmation.checked).toBe(true);
});

test("unsupported or malformed stored theme preferences fall back without executing external theme code", () => {
  for (const value of [null, "missing", { id: "eastern", version: 2 }, { id: "https://example.com/theme.js", version: 1 }]) {
    expect(resolveTheme(value).id).toBe("cyberpunk");
  }
  expect(resolveTheme({ id: "eastern", version: 1 }).label).toBe("山水 · 行旅");
});
