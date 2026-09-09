// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LogoutForm } from "./logout-form";
import { logoutAction } from "./actions";
import LogoutRecoveryPage from "./auth/logout-recovery/page";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { cookieJar.set(name, value); },
}) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  cookieJar.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("blocks duplicate submissions and checks identity before any further mutation after a lost action response", async () => {
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
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/auth/logout-recovery");
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(requests).toBe(1);
  expect(host.textContent).toContain("无法确认退出结果");
});

it("preserves remote revocation uncertainty when SDK cookie removal arrives before the action response is lost", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://logout.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  cookieJar.set("sb-logout-auth-token", `base64-${Buffer.from(JSON.stringify({
    access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "a7000000-0000-4000-8000-000000000001" },
  })).toString("base64url")}`);
  vi.stubGlobal("fetch", async () => Response.json({ message: "provider unavailable" }, { status: 503 }));
  // Simulate the Server Action transport losing its redirect body after cookie
  // updates. The actual action, Supabase SDK and recovery page remain real.
  const lostResponse = async () => { try { await logoutAction(); } catch { throw new TypeError("response body lost"); } };
  await act(async () => root.render(<LogoutForm action={lostResponse} />));
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/auth/logout-recovery");
  expect(host.querySelector("button")).toBeNull();
  const recovery = renderToStaticMarkup(await LogoutRecoveryPage());
  expect(recovery).toContain("当前浏览器没有有效登录");
  expect(recovery).toContain("其他设备可能仍保持登录");
  expect(recovery).toContain('type="email"');
});
