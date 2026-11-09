import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  resolveExtensionRequestActor,
  resolveRequestActor,
} from "../supabase/request";

const fixture = vi.hoisted(() => ({
  local: vi.fn(),
  headers: vi.fn(),
  cloudServer: vi.fn(),
  cloudSdk: vi.fn(),
}));
vi.mock("./local-database", () => ({ localDatabase: fixture.local }));
vi.mock("next/headers", () => ({ headers: fixture.headers }));
vi.mock("../supabase/server", () => ({
  createServerSupabase: fixture.cloudServer,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: fixture.cloudSdk }));
const actor = {
  userId: "6773a327-4364-4535-a843-d3e94a7296e6",
  client: "web" as const,
};
const localClient = { local: true };
function request(host?: string, authorization?: string) {
  const headers = new Headers();
  if (host !== undefined) headers.set("host", host);
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://127.0.0.1:3000/api/companion", {
    headers,
  }) as NextRequest;
}
function noCloudWork() {
  expect(fixture.cloudServer).not.toHaveBeenCalled();
  expect(fixture.cloudSdk).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLUEPRINT_COMPANION_STORAGE", "local");
  fixture.local.mockResolvedValue({ actor, client: localClient });
  fixture.headers.mockResolvedValue(new Headers({ host: "127.0.0.1:3000" }));
  fixture.cloudServer.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  fixture.cloudSdk.mockImplementation(() => {
    throw new Error("Hosted SDK must not be used by local authentication");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("No network request is allowed in local identity tests");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loopback-only local request identity", () => {
  it.each(["127.0.0.1:3000", "localhost:3000", "[::1]:3000"])(
    "resolves an explicit local Web identity for %s without hosted credentials",
    async (host) => {
      const result = await resolveRequestActor(request(host));
      expect(result).toEqual({
        ok: true,
        value: { actor, client: localClient },
      });
      expect(fixture.local).toHaveBeenCalledOnce();
      expect(fixture.headers).not.toHaveBeenCalled();
      noCloudWork();
    },
  );
  it.each([
    undefined,
    "192.168.1.10:3000",
    "blueprint.example:3000",
    "0.0.0.0:3000",
    "localhost.attacker.test:3000",
    "127.0.0.1:3000@attacker.test",
  ])(
    "rejects non-loopback or absent Host %j before opening the local database",
    async (host) => {
      expect(await resolveRequestActor(request(host))).toEqual({
        ok: false,
        code: "unauthenticated",
      });
      expect(fixture.local).not.toHaveBeenCalled();
      noCloudWork();
    },
  );
  it.each([
    "Bearer untrusted-token",
    "bearer untrusted-token",
    "Basic dGVzdDp0ZXN0",
    "",
  ])(
    "never elevates an Authorization header %j into the local Web identity",
    async (authorization) => {
      expect(
        await resolveRequestActor(request("127.0.0.1:3000", authorization)),
      ).toEqual({ ok: false, code: "unauthenticated" });
      expect(fixture.local).not.toHaveBeenCalled();
      noCloudWork();
    },
  );
  it("does not authorize a remote Host using a loopback X-Forwarded-Host", async () => {
    const incoming = request("attacker.test:3000");
    incoming.headers.set("x-forwarded-host", "127.0.0.1:3000");
    expect(await resolveRequestActor(incoming)).toEqual({
      ok: false,
      code: "unauthenticated",
    });
    expect(fixture.local).not.toHaveBeenCalled();
    noCloudWork();
  });
  it("does not turn the local Web actor into extension authorization", async () => {
    expect(
      await resolveExtensionRequestActor(request("127.0.0.1:3000")),
    ).toEqual({ ok: false, code: "unauthenticated" });
    noCloudWork();
  });
  it("does not fall back to a hosted identity when local database initialization fails", async () => {
    fixture.local.mockRejectedValueOnce(
      new Error("local database unavailable"),
    );
    await expect(
      resolveRequestActor(request("127.0.0.1:3000")),
    ).rejects.toThrow("local database unavailable");
    noCloudWork();
  });
  it("does not enable local authentication in production despite an explicit local storage setting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await resolveRequestActor(request("127.0.0.1:3000"))).toEqual({
      ok: false,
      code: "unauthenticated",
    });
    expect(fixture.local).not.toHaveBeenCalled();
    expect(fixture.cloudSdk).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Server Component local identity without an explicit request", () => {
  it("uses the incoming Next headers and returns the local actor without hosted auth", async () => {
    expect(await resolveRequestActor()).toEqual({
      ok: true,
      value: { actor, client: localClient },
    });
    expect(fixture.headers).toHaveBeenCalledOnce();
    expect(fixture.local).toHaveBeenCalledOnce();
    noCloudWork();
  });
  it.each([
    new Headers({ host: "blueprint.example" }),
    new Headers({
      host: "localhost:3000",
      authorization: "Bearer foreign-token",
    }),
    new Headers(),
  ])(
    "rejects missing, remote or bearer-authenticated server headers",
    async (headers) => {
      fixture.headers.mockResolvedValueOnce(headers);
      expect(await resolveRequestActor()).toEqual({
        ok: false,
        code: "unauthenticated",
      });
      expect(fixture.local).not.toHaveBeenCalled();
      noCloudWork();
    },
  );
});
