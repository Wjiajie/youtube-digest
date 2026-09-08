// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BlueprintSnapshot } from "@blueprint/domain";
import { BlueprintEditor } from "./blueprint-editor";
import { ThemeSurface } from "@blueprint/ui/theme";

const initial: BlueprintSnapshot = {
  schemaVersion: 1,
  id: "018f6f68-9b4d-7c93-a134-c8571b8f7701",
  version: 1,
  title: "我的蓝图",
  goals: [],
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("opening an unchanged saved blueprint does not claim to recover unsaved changes", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: initial, resourceUrls: {},
  }));
  await act(async () => root.render(<BlueprintEditor initial={initial} sessions={[]} />));
  expect(host.textContent).not.toContain("已恢复上次尚未确认的修改");
});

test("opening a blueprint restores an actual unsaved edit", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: { ...initial, title: "职业成长蓝图" }, resourceUrls: {},
  }));
  await act(async () => root.render(<BlueprintEditor initial={initial} sessions={[]} />));
  expect(host.querySelector("input")?.value).toBe("职业成长蓝图");
  expect(host.textContent).toContain("已恢复上次尚未确认的修改");
});

test("switching both themes keeps the real editor draft and text selection without a blueprint revision", async () => {
  localStorage.setItem(`blueprint-draft:${initial.id}`, JSON.stringify({
    baseVersion: initial.version, draft: { ...initial, title: "尚未确认的职业成长蓝图" }, resourceUrls: {},
  }));
  await act(async () => root.render(<ThemeSurface theme="cyberpunk"><BlueprintEditor initial={initial} sessions={[]} /></ThemeSurface>));
  const input = host.querySelector("input")!;
  input.focus();
  input.setSelectionRange(2, 5);
  const recovery = localStorage.getItem(`blueprint-draft:${initial.id}`);
  for (const theme of ["eastern", "cyberpunk"] as const) {
    await act(async () => root.render(<ThemeSurface theme={theme}><BlueprintEditor initial={initial} sessions={[]} /></ThemeSurface>));
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("尚未确认的职业成长蓝图");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(input);
    expect(localStorage.getItem(`blueprint-draft:${initial.id}`)).toBe(recovery);
  }
  expect(initial.version).toBe(1);
});
