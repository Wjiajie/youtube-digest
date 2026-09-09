import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GET as readBlueprint } from "./api/v1/blueprint/route";
import { GET as readSessions, POST as startSession } from "./api/v1/learning-sessions/route";
import { POST as recordSync } from "./api/v1/events/sync/route";
import { POST as recordAuthorization } from "./api/v1/events/extension-authorization/route";
import { POST as recordRevocation } from "./api/v1/events/extension-revoked/route";
import { createProposalAction, applyProposalAction, rejectProposalAction } from "./actions";
import HomePage from "./page";
import BlueprintEditPage from "./blueprint/edit/page";
import PathsPage from "./paths/page";
import GoalPathPage from "./paths/[goalId]/page";
import LoginPage from "./login/page";
import ConnectionsPage from "./settings/connections/page";
import OAuthConsentPage from "./oauth/consent/page";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieJar, set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const ownerId = "a4000000-0000-4000-8000-000000000001";
const extensionId = "recovery-extension";
const blueprintId = "a4000000-0000-4000-8000-000000000002";
const proposalId = "a4000000-0000-4000-8000-000000000003";
const mutationId = "a4000000-0000-4000-8000-000000000004";
const token = (clientId?: string) => [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: ownerId, ...(clientId ? { client_id: clientId } : {}) })).toString("base64url"),
  "fixture-signature",
].join(".");
let authStatus = 200;
let version = 0;

beforeEach(() => {
  cookieJar.length = 0;
  authStatus = 200;
  version = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID", extensionId);
  // Only the external Auth/REST transport is replaced. Request resolution,
  // Supabase SDK, application logic and caller-visible handlers remain real.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/auth/v1/user") return authStatus === 200
      ? Response.json({ id: ownerId })
      : Response.json({ message: "private provider failure details" }, { status: authStatus });
    if (url.pathname === "/rest/v1/rpc/read_blueprint_snapshot_v2") return Response.json({ schemaVersion: 2, id: blueprintId, title: "My path", version, goals: [] });
    if (url.pathname === "/rest/v1/learning_sessions") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/apply_blueprint_proposal") {
      version = 1;
      return Response.json(1);
    }
    if (url.pathname === "/rest/v1/product_events") return new Response(null, { status: 201 });
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function extensionRequest(path: string) {
  return new NextRequest(`https://blueprint.example.com${path}`, {
    headers: { authorization: `Bearer ${token(extensionId)}` },
  });
}

function signInWeb() {
  cookieJar.push({
    name: "sb-recovery-auth-token",
    value: `base64-${Buffer.from(JSON.stringify({
      access_token: token(), refresh_token: "fixture-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: ownerId },
    })).toString("base64url")}`,
  });
}

it("prevents browsers and shared caches from retaining a personal Blueprint response", async () => {
  const response = await readBlueprint(extensionRequest("/api/v1/blueprint"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).id).toBe(blueprintId);
});

it.each([200, 401, 503])("does not cache learning history or its identity failure (%i)", async (status) => {
  authStatus = status;
  const response = await readSessions(extensionRequest("/api/v1/learning-sessions"));
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(status === 200 ? [] : {
    code: status === 401 ? "unauthenticated" : "unavailable",
  });
});

it("keeps an Auth outage distinct from revoked extension authorization when reading the Blueprint", async () => {
  authStatus = 503;
  const response = await readBlueprint(extensionRequest("/api/v1/blueprint"));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ code: "unavailable" });
});

it.each([
  ["learning history", () => readSessions(extensionRequest("/api/v1/learning-sessions"))],
  ["learning start", () => startSession(extensionRequest("/api/v1/learning-sessions"))],
  ["sync event", () => recordSync(extensionRequest("/api/v1/events/sync"))],
  ["authorization event", () => recordAuthorization(new Request("https://blueprint.example.com/api/v1/events/extension-authorization"))],
  ["revocation event", () => recordRevocation()],
] as const)("reports an Auth outage as recoverable for %s", async (_label, call) => {
  signInWeb();
  authStatus = 503;
  const response = await call();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "unavailable" });
});

it.each([429, 500, 502, 504])("preserves retryable Auth status %i without clearing a valid login", async (status) => {
  signInWeb();
  authStatus = status;
  const response = await readBlueprint(extensionRequest("/api/v1/blueprint"));
  expect(response.status).toBe(503);
  expect(await applyProposalAction({ proposalId, expectedVersion: 0, clientMutationId: mutationId }))
    .toEqual({ ok: false, code: "unavailable" });
});

it("recovers reads and a pending confirmation with the same credentials after Auth resumes", async () => {
  signInWeb();
  authStatus = 503;
  expect((await readBlueprint(extensionRequest("/api/v1/blueprint"))).status).toBe(503);
  const confirmation = { proposalId, expectedVersion: 0, clientMutationId: mutationId };
  expect(await applyProposalAction(confirmation)).toEqual({ ok: false, code: "unavailable" });
  authStatus = 200;
  const response = await readBlueprint(extensionRequest("/api/v1/blueprint"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schemaVersion: 2, id: blueprintId, version: 0, title: "My path", goals: [] });
  expect(await applyProposalAction(confirmation)).toEqual({ ok: true, value: {
    schemaVersion: 2, id: blueprintId, version: 1, title: "My path", goals: [],
  } });
});

it.each([400, 401, 403, 422])("still rejects invalid Auth status %i without exposing private provider details", async (status) => {
  signInWeb();
  authStatus = status;
  const response = await readBlueprint(extensionRequest("/api/v1/blueprint"));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "unauthenticated" });
  expect(await rejectProposalAction({ proposalId })).toEqual({ ok: false, code: "unauthenticated" });
});

it("keeps the extension-only API closed to Web cookies and other OAuth clients", async () => {
  signInWeb();
  const anonymous = await readBlueprint(new NextRequest("https://blueprint.example.com/api/v1/blueprint"));
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  expect((await readBlueprint(new NextRequest("https://blueprint.example.com/api/v1/blueprint", {
    headers: { authorization: `Bearer ${token("other-client")}` },
  }))).status).toBe(401);
});

it("offers a public example for an absent session and preserves explicit login and OAuth continuations", async () => {
  await expect(HomePage()).rejects.toThrow("redirect:/preview");
  const login = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(login).toContain('type="email"');
  await expect(OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: "pending-authorization" }) }))
    .rejects.toThrow("redirect:/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dpending-authorization");
});

it("never creates an external retry redirect from an untrusted login continuation", async () => {
  signInWeb();
  authStatus = 503;
  const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: "https://attacker.example/" }) }));
  expect(html).toContain('href="/login?next=%2F"');
  expect(html).not.toContain("attacker.example");
});

it("keeps the personal homepage recoverable instead of redirecting during an Auth outage", async () => {
  signInWeb();
  authStatus = 503;
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain("暂时无法验证登录状态");
  expect(html).toContain('href="/"');
  expect(html).not.toContain("My path");
});

it.each([
  [() => BlueprintEditPage(), "/blueprint/edit"],
  [() => PathsPage(), "/paths"],
  [() => GoalPathPage({ params: Promise.resolve({ goalId: blueprintId }), searchParams: Promise.resolve({ node: mutationId }) }), `/paths/${blueprintId}?node=${mutationId}`],
] as const)("protects formal path routes and preserves their continuation during Auth failure", async (page, path) => {
  await expect(page()).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(path)}`);
  signInWeb(); authStatus = 503;
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("暂时无法验证登录状态");
  expect(html).toContain(`href="${path}"`);
  expect(html).not.toContain("My path");
});

it.each([
  ["connections", () => ConnectionsPage(), "/settings/connections"],
  ["consent", () => OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: "pending-authorization" }) }), "/oauth/consent?authorization_id=pending-authorization"],
  ["login", () => LoginPage({ searchParams: Promise.resolve({ next: "/settings/connections" }) }), "/login?next=%2Fsettings%2Fconnections"],
] as const)("preserves the %s continuation without showing a fresh login form during Auth failure", async (_label, page, retryPath) => {
  signInWeb();
  authStatus = 503;
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("暂时无法验证登录状态");
  expect(html).toContain(`href="${retryPath}"`);
  expect(html).not.toContain('type="email"');
});

it.each([
  ["create", () => createProposalAction({
    draft: { schemaVersion: 1, id: blueprintId, version: 0, title: "My path", goals: [] },
    baseVersion: 0, clientMutationId: mutationId,
  })],
  ["confirm", () => applyProposalAction({ proposalId, expectedVersion: 0, clientMutationId: mutationId })],
  ["reject", () => rejectProposalAction({ proposalId })],
] as const)("lets the user retry %s after an Auth outage instead of asking them to sign in again", async (_label, call) => {
  signInWeb();
  authStatus = 503;
  expect(await call()).toEqual({ ok: false, code: "unavailable" });
});
