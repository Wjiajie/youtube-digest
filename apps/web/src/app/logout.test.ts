import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { logoutAction } from "./actions";
import LoginPage from "./login/page";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { cookieJar.set(name, value); },
}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const ownerId = "a7000000-0000-4000-8000-000000000001";
let logoutStatus = 204;
let userStatus = 200;

function signIn() {
  cookieJar.set("sb-logout-auth-token", `base64-${Buffer.from(JSON.stringify({
    access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: ownerId },
  })).toString("base64url")}`);
}

beforeEach(() => {
  cookieJar.clear();
  signIn();
  logoutStatus = 204;
  userStatus = 200;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://logout.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  // Only replace the external provider transport, not the SDK/session adapter.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/logout") return logoutStatus === 204
      ? new Response(null, { status: 204 })
      : Response.json({ message: "private provider details" }, { status: logoutStatus });
    if (url.pathname === "/auth/v1/user") return userStatus === 200
      ? Response.json({ id: ownerId })
      : Response.json({ message: "private provider details" }, { status: userStatus });
    throw new Error("Unexpected provider request");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("does not silently report normal logout when remote revocation fails even though the SDK removes this session", async () => {
  logoutStatus = 503;
  await expect(logoutAction()).rejects.toThrow("redirect:/auth/logout-recovery");
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('type="email"');
});

it("guides a locally signed-out user back through login before retrying remote revocation", async () => {
  logoutStatus = 503;
  await expect(logoutAction()).rejects.toThrow("redirect:/auth/logout-recovery");
  const { default: LogoutRecoveryPage } = await import("./auth/logout-recovery/page");
  const html = renderToStaticMarkup(await LogoutRecoveryPage());
  expect(html).toContain("无法确认完整退出");
  expect(html).toContain("当前浏览器没有有效登录");
  expect(html).toContain("其他设备可能仍保持登录");
  expect(html).toContain('type="email"');
  expect(html).not.toContain("重试退出</button>");
  expect(html).not.toContain("private provider details");
});

it("offers explicit logout retry instead of another email request once the user is signed in", async () => {
  const { default: LogoutRecoveryPage } = await import("./auth/logout-recovery/page");
  const html = renderToStaticMarkup(await LogoutRecoveryPage());
  expect(html).toContain("当前浏览器仍有有效登录");
  expect(html).toContain("重试退出所有设备</button>");
  expect(html).not.toContain('type="email"');
  await expect(logoutAction()).rejects.toThrow("redirect:/login");
  const login = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(login).toContain('type="email"');
});

it("never claims a session is cleared or resends mail when recovery cannot verify identity", async () => {
  userStatus = 503;
  const { default: LogoutRecoveryPage } = await import("./auth/logout-recovery/page");
  const html = renderToStaticMarkup(await LogoutRecoveryPage());
  expect(html).toContain("暂时无法验证当前登录状态");
  expect(html).toContain('href="/auth/logout-recovery"');
  expect(html).not.toContain("当前浏览器没有有效登录");
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("重试退出所有设备</button>");
});

it.each([429, 500, 502, 504])("keeps remote logout failure %i visible without retaining a logged-in page", async (status) => {
  logoutStatus = status;
  await expect(logoutAction()).rejects.toThrow("redirect:/auth/logout-recovery");
  const { default: LogoutRecoveryPage } = await import("./auth/logout-recovery/page");
  expect(renderToStaticMarkup(await LogoutRecoveryPage())).toContain("当前浏览器没有有效登录");
});

it.each([401, 403, 404])("allows local logout when Auth reports an already invalid session (%i)", async (status) => {
  logoutStatus = status;
  await expect(logoutAction()).rejects.toThrow("redirect:/login");
  expect(renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))).toContain('type="email"');
});

it("does not need an existing session to reach the ordinary sign-in screen", async () => {
  cookieJar.clear();
  await expect(logoutAction()).rejects.toThrow("redirect:/login");
});

it("keeps unexpected logout setup failures recoverable rather than exposing an exception", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  await expect(logoutAction()).rejects.toThrow("redirect:/auth/logout-recovery");
  const { default: LogoutRecoveryPage } = await import("./auth/logout-recovery/page");
  const html = renderToStaticMarkup(await LogoutRecoveryPage());
  expect(html).toContain("暂时无法验证当前登录状态");
  expect(html).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
});
