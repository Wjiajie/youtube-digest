// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LogoutForm } from "./logout-form";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("blocks duplicate pending submissions and offers an honest retry when the action transport fails", async () => {
  let rejectRequest!: (reason: Error) => void;
  let requests = 0;
  const action = async () => { requests++; return new Promise<void>((_resolve, reject) => { rejectRequest = reject; }); };
  await act(async () => root.render(<LogoutForm action={action} />));
  const form = host.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(requests).toBe(1);
  expect(host.querySelector("button")?.disabled).toBe(true);
  expect(host.textContent).toContain("正在退出");
  await act(async () => rejectRequest(new Error("private transport details")));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("无法确认退出结果");
  expect(host.textContent).not.toContain("private transport details");
  expect(host.querySelector("button")?.disabled).toBe(false);
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(requests).toBe(2);
  expect(host.textContent).not.toContain("无法确认退出结果");
  await act(async () => rejectRequest(new Error("offline")));
});
