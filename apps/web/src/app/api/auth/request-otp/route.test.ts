import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { POST } from "./route";

// Next's request cookie jar is an external runtime boundary. Exercise the real
// Supabase clients against a controlled HTTP provider, not application mocks.
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

let providerStatus = 200;
let providerBody: object = {};
let preparationUnavailable = false;

beforeEach(() => {
  providerStatus = 200;
  providerBody = {};
  preparationUnavailable = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/functions/v1/prepare-invited-login")) {
      if (preparationUnavailable) return Response.json({}, { status: 503 });
      return Response.json({ ok: true });
    }
    if (url.includes("/auth/v1/otp")) {
      return Response.json(providerBody, { status: providerStatus, headers: { "x-supabase-api-version": "2024-01-01" } });
    }
    throw new Error("Unexpected external request in test");
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function loginRequest() {
  return new Request("https://blueprint.example.com/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email: "invited@example.com" }),
  });
}

it("reports an email quota failure instead of claiming the request succeeded", async () => {
  providerStatus = 429;
  providerBody = { code: "over_email_send_rate_limit", msg: "Email rate limit exceeded" };
  const response = await POST(loginRequest());
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ ok: false, code: "rate_limited" });
});

it("reports provider unavailability without exposing provider messages or the email", async () => {
  providerStatus = 503;
  providerBody = { code: "unexpected_failure", msg: "SMTP failed for invited@example.com" };
  const response = await POST(loginRequest());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "temporarily_unavailable" });
});

it("returns the same accepted response for an unknown email and an eligible email", async () => {
  const eligible = await POST(loginRequest());
  providerStatus = 400;
  providerBody = { code: "otp_disabled", msg: "Signups not allowed for otp" };
  const unknown = await POST(loginRequest());
  expect(unknown.status).toBe(eligible.status);
  expect(await unknown.json()).toEqual(await eligible.json());
});

it("does not claim mail delivery on an accepted request", async () => {
  expect(await (await POST(loginRequest())).json()).toEqual({ ok: true, status: "accepted" });
});

it("reports invitation service outages instead of accepting a request that was not prepared", async () => {
  preparationUnavailable = true;
  const response = await POST(loginRequest());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: "temporarily_unavailable" });
});
