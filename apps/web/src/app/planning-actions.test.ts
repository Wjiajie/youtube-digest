import { afterEach, expect, it, vi } from "vitest";
import { readPlanningRunAction, cancelPlanningRunAction } from "./planning-actions";
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
afterEach(() => vi.unstubAllEnvs());
it("requires a real session to read or cancel a planning run", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://planning.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture");
  expect(await readPlanningRunAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await cancelPlanningRunAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
});
