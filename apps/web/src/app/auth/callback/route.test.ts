import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import LoginPage from "../../login/page";
import { GET } from "./route";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { cookieJar.set(name, value); },
}) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const ownerId = "a6000000-0000-4000-8000-000000000001";
let userStatus = 200;
let exchangeStatus = 200;
let codeConsumed = false;

beforeEach(() => {
  cookieJar.clear();
  cookieJar.set("sb-callback-auth-token-code-verifier", JSON.stringify("fixture-verifier"));
  userStatus = 200;
  exchangeStatus = 200;
  codeConsumed = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://callback.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  // Keep the SDK, cookie persistence and application code real; replace only
  // the provider's HTTP transport, including one-time code semantics.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/token") {
      if (exchangeStatus !== 200) return Response.json({ message: "private provider details" }, { status: exchangeStatus });
      const body = await request.json();
      if (codeConsumed || body.auth_code !== "fixture-code" || body.code_verifier !== "fixture-verifier") {
        return Response.json({ code: "flow_state_not_found", message: "invalid code" }, { status: 400 });
      }
      codeConsumed = true;
      return Response.json({
        access_token: "fixture-access-token", refresh_token: "fixture-refresh-token",
        token_type: "bearer", expires_in: 3600, user: { id: ownerId },
      });
    }
    if (url.pathname === "/auth/v1/user") return userStatus === 200
      ? Response.json({ id: ownerId })
      : Response.json({ message: "private provider details" }, { status: userStatus });
    if (url.pathname === "/rest/v1/product_events") return new Response(null, { status: 201 });
    throw new Error("Unexpected provider request");
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function callback(next = "/settings/connections", code = "fixture-code", flowId?: string) {
  return GET(new NextRequest(`https://blueprint.example.com/auth/callback?${new URLSearchParams({ code, next, ...(flowId === undefined ? {} : { sb_flow_id: flowId }) })}`));
}

it("preserves a successfully exchanged session through an Auth outage without replaying the one-time code", async () => {
  userStatus = 503;
  const response = await callback();
  expect(response.headers.get("location")).toBe("https://blueprint.example.com/settings/connections");
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "/settings/connections" }) }));
  expect(html).toContain("暂时无法验证登录状态");
  expect(html).not.toContain('type="email"');
  userStatus = 200;
  await expect(LoginPage({ searchParams: Promise.resolve({ next: "/settings/connections" }) }))
    .rejects.toThrow("redirect:/settings/connections");
});

it("gives an honest recovery path after a transient exchange failure without retaining the one-time code", async () => {
  exchangeStatus = 503;
  const response = await callback("/oauth/consent?authorization_id=pending");
  const destination = new URL(response.headers.get("location")!);
  expect(destination.pathname).toBe("/login");
  expect(destination.searchParams.get("error")).toBe("exchange_unavailable");
  expect(destination.searchParams.get("next")).toBe("/oauth/consent?authorization_id=pending");
  expect(destination.searchParams.has("code")).toBe(false);
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(Object.fromEntries(destination.searchParams)) }));
  expect(html).toContain("暂时无法完成登录");
  expect(html).toContain("不要反复点击旧链接");
  expect(html).not.toContain("链接已失效");
  expect(html).not.toContain("private provider details");
});

it.each(["/\\attacker.example/path", "/\t/attacker.example/path", "/\n/attacker.example/path"])(
  "never follows a browser-normalized external continuation: %j", async (next) => {
    const response = await callback(next);
    expect(response.headers.get("location")).toBe("https://blueprint.example.com/");
  },
);

it.each([200, 400, 503])("makes credential callback responses explicitly non-cacheable (Auth %i)", async (status) => {
  exchangeStatus = status;
  const response = await callback();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it("exchanges the requested PKCE flow even when another email request replaced the legacy verifier", async () => {
  cookieJar.set("sb-callback-auth-token-code-verifier", JSON.stringify("other-request-verifier"));
  cookieJar.set("sb-callback-auth-token-flow-fixture_flow_123-code-verifier", JSON.stringify("fixture-verifier"));
  const response = await callback("/settings/connections", "fixture-code", "fixture_flow_123");
  expect(response.headers.get("location")).toBe("https://blueprint.example.com/settings/connections");
});

it.each(["", "invalid!", "missing_flow_123"])("does not borrow a different verifier for an invalid or missing flow %j", async (flowId) => {
  const response = await callback("/", "fixture-code", flowId);
  expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("invalid_link");
});

it.each([429, 500, 502, 504])("keeps transient exchange status %i distinct from an expired link", async (status) => {
  exchangeStatus = status;
  const response = await callback();
  expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("exchange_unavailable");
});

it.each([400, 401, 403, 422])("still rejects invalid credentials reported by Auth %i", async (status) => {
  exchangeStatus = status;
  const response = await callback();
  expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("invalid_link");
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ error: "invalid_link" }) }));
  expect(html).toContain("登录链接已失效或无法验证");
});

it("offers a fresh sign-in for a missing or already consumed link without replacing a valid session", async () => {
  const missing = await callback("/", "");
  expect(new URL(missing.headers.get("location")!).searchParams.get("error")).toBe("invalid_link");
  await callback();
  const repeated = await callback();
  expect(new URL(repeated.headers.get("location")!).searchParams.get("error")).toBe("invalid_link");
  await expect(LoginPage({ searchParams: Promise.resolve({ error: "invalid_link", next: "/settings/connections" }) }))
    .rejects.toThrow("redirect:/settings/connections");
});

it("recovers unexpected setup failure without leaking configuration or a code into the login URL", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  const response = await callback();
  expect(response.headers.get("location")).toBe("https://blueprint.example.com/login?error=exchange_unavailable&next=%2Fsettings%2Fconnections");
});
