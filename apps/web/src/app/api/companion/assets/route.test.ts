import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
const fixture = vi.hoisted(() => ({ actor: vi.fn(), asset: vi.fn() }));
vi.mock("@/lib/supabase/request", () => ({
  resolveRequestActor: fixture.actor,
}));
vi.mock("@/lib/companion/assets", () => ({ privateAsset: fixture.asset }));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.actor.mockResolvedValue({ ok: false });
  fixture.asset.mockResolvedValue(Buffer.from("private test model"));
});
afterEach(() => vi.unstubAllEnvs());
it.each(["production", "test"])(
  "never bypasses account authentication in %s",
  async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("COMPANION_LOCAL_PREVIEW", "true");
    expect(
      (
        await GET(
          new Request(
            "http://127.0.0.1:3000/api/companion/assets?id=shayna-vrm1",
          ),
        )
      ).status,
    ).toBe(401);
    expect(fixture.asset).not.toHaveBeenCalled();
  },
);
it("requires an explicit development opt-in even on loopback", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("COMPANION_LOCAL_PREVIEW", "false");
  expect(
    (
      await GET(
        new Request(
          "http://127.0.0.1:3000/api/companion/assets?id=shayna-vrm1",
        ),
      )
    ).status,
  ).toBe(401);
  expect(fixture.asset).not.toHaveBeenCalled();
});
it("allows opted-in loopback development review with private cache headers", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("COMPANION_LOCAL_PREVIEW", "true");
  const result = await GET(
    new Request("http://127.0.0.1:3000/api/companion/assets?id=shayna-vrm1"),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(fixture.asset).toHaveBeenCalledWith("shayna-vrm1");
});
it("does not permit the development opt-in for a public hostname", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("COMPANION_LOCAL_PREVIEW", "true");
  expect(
    (
      await GET(
        new Request("http://example.test/api/companion/assets?id=shayna-vrm1"),
      )
    ).status,
  ).toBe(401);
});
