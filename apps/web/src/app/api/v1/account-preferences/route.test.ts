import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GET } from "./route";
import { saveAccountThemeAction } from "@/app/account-preferences-actions";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));

const ownerId = "a1000000-0000-4000-8000-000000000001";
const extensionId = "preferences-extension";
const accessToken = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: ownerId, client_id: extensionId })).toString("base64url"),
  "test-signature",
].join(".");
let storedPreference = { theme_id: "eastern", theme_version: 1, preferences_revision: 4 };
let providerUnavailable = false;

beforeEach(() => {
  cookieJar.length = 0;
  storedPreference = { theme_id: "eastern", theme_version: 1, preferences_revision: 4 };
  providerUnavailable = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://preferences.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extensionId);
  // Exercise real request authentication and the Supabase client against the
  // external HTTP boundary. RLS itself is exercised in real PostgreSQL tests.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: ownerId });
    if (url.pathname === "/rest/v1/profiles") {
      // Keep the real SDK retry behavior but avoid wall-clock backoff in this
      // provider fixture: all attempts receive a terminal service failure.
      if (providerUnavailable) return Response.json({ message: "private database details" }, {
        status: 503, headers: { "Retry-After": "0" },
      });
      expect(url.searchParams.get("id")).toBe(`eq.${ownerId}`);
      if (request.method === "PATCH") {
        if (url.searchParams.get("preferences_revision") !== `eq.${storedPreference.preferences_revision}`) return Response.json(null);
        const saved = await request.json();
        storedPreference = { ...saved, preferences_revision: storedPreference.preferences_revision + 1 };
      }
      return Response.json(storedPreference);
    }
    throw new Error("Unexpected external request");
  });
});

function signInWeb() {
  cookieJar.push({
    name: "sb-preferences-auth-token",
    value: `base64-${Buffer.from(JSON.stringify({
      access_token: accessToken,
      refresh_token: "test-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: ownerId },
    })).toString("base64url")}`,
  });
}

it("saves a Web choice with a separate revision and makes it readable by the extension", async () => {
  signInWeb();
  const saved = await saveAccountThemeAction({ theme: { id: "cyberpunk", version: 1 }, expectedRevision: 4 });
  expect(saved).toEqual({ ok: true, value: { theme: { id: "cyberpunk", version: 1 }, revision: 5 } });
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences", {
    headers: { authorization: `Bearer ${accessToken}` },
  }));
  expect(await response.json()).toEqual({ theme: { id: "cyberpunk", version: 1 }, revision: 5 });
});

it("reports a stale Web choice without replacing the current theme", async () => {
  signInWeb();
  expect(await saveAccountThemeAction({ theme: { id: "cyberpunk", version: 1 }, expectedRevision: 3 }))
    .toEqual({ ok: false, code: "version_conflict" });
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences"));
  expect(await response.json()).toEqual({ theme: { id: "eastern", version: 1 }, revision: 4 });
});

it("rejects unsupported themes, versions and user-supplied ownership", async () => {
  signInWeb();
  for (const input of [
    { theme: { id: "https://external.example.com/theme", version: 1 }, expectedRevision: 4 },
    { theme: { id: "unbundled", version: 1 }, expectedRevision: 4 },
    { theme: { id: "eastern", version: 99 }, expectedRevision: 4 },
    { theme: { id: "eastern", version: 1 }, expectedRevision: 4, userId: "another-account" },
    { theme: { id: "eastern", version: 1 }, expectedRevision: -1 },
  ]) {
    expect(await saveAccountThemeAction(input)).toEqual({ ok: false, code: "invalid" });
  }
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences"));
  expect(await response.json()).toEqual({ theme: { id: "eastern", version: 1 }, revision: 4 });
});

it("does not replace future stored theme data with a fallback on read", async () => {
  signInWeb();
  storedPreference = { theme_id: "future-theme", theme_version: 2, preferences_revision: 4 };
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences"));
  expect(await response.json()).toEqual({ theme: { id: "future-theme", version: 2 }, revision: 4 });
});

it("requires authentication for both reading and saving", async () => {
  expect(await saveAccountThemeAction({ theme: { id: "eastern", version: 1 }, expectedRevision: 4 }))
    .toEqual({ ok: false, code: "unauthenticated" });
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("rejects a bearer token issued to a different OAuth client", async () => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", "different-client");
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences", {
    headers: { authorization: `Bearer ${accessToken}` },
  }));
  expect(response.status).toBe(401);
});

it("reports a provider failure without exposing database details or claiming a save", async () => {
  signInWeb();
  providerUnavailable = true;
  expect(await saveAccountThemeAction({ theme: { id: "eastern", version: 1 }, expectedRevision: 4 }))
    .toEqual({ ok: false, code: "unavailable" });
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "unavailable" });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("gives an authorized extension the account preference without a shared-cache response", async () => {
  const response = await GET(new NextRequest("https://blueprint.example.com/api/v1/account-preferences", {
    headers: { authorization: `Bearer ${accessToken}` },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ theme: { id: "eastern", version: 1 }, revision: 4 });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
