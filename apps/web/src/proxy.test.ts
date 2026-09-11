import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["/api/planning/runs", "/api/clarification/turns", "/api/resources/runs", "/api/v1/learning-notes",
  "/api/translations/runs", "/api/translations/runs/a6000000-0000-4000-8000-000000000001",
  "/api/translations/runs/A6000000-0000-4000-8000-000000000001"])("lets the independently authenticated %s handler own its upload deadline", path => {
  for (const suffix of ["", "/", "?probe=1"]) expect(unstable_doesMiddlewareMatch({ config, url: `https://blueprint.example${path}${suffix}` })).toBe(false);
});
it.each(["/api/planning/runs/history", "/api/planning/runs-extra", "/api/clarification/turns/history", "/api/clarification/turns-extra",
  "/api/resources/runs/history", "/api/resources/runs-extra", "/api/v1/learning-notes/history", "/api/v1/learning-notes-extra",
  "/api/translations/runs/history", "/api/translations/runs-extra", "/api/translations/runs/a6000000-0000-4000-8000-000000000001/history",
  "/api/translations/runs/not-a-uuid"])("keeps the upload exception from widening to %s", path => {
  expect(unstable_doesMiddlewareMatch({ config, url: `https://blueprint.example${path}` })).toBe(true);
});

it.each(["/", "/paths", "/blueprint/edit", "/api/v1/blueprint", "/preview/private"])("does not expand the public exception to %s", async path => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proxy.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
  const accessToken = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "a6000000-0000-4000-8000-000000000001" })).toString("base64url"), "fixture"].join(".");
  const value = `base64-${Buffer.from(JSON.stringify({ access_token: accessToken, refresh_token: "fixture-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer" })).toString("base64url")}`;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    expect(new URL(input instanceof Request ? input.url : String(input)).pathname).toBe("/auth/v1/user");
    return Response.json({ id: "a6000000-0000-4000-8000-000000000001" });
  });
  vi.stubGlobal("fetch", fetch);
  const response = await proxy(new NextRequest(`https://blueprint.example${path}`, { headers: { cookie: `sb-proxy-auth-token=${value}` } }));
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledOnce();
});

it("serves the public example without Auth configuration or touching stale cookies", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  const fetch = vi.fn(() => { throw new Error("Public example must not contact a provider"); });
  vi.stubGlobal("fetch", fetch);
  const response = await proxy(new NextRequest("https://blueprint.example/preview?theme=eastern", {
    headers: { cookie: "sb-example-auth-token=stale" },
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
