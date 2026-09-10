import { afterEach, expect, it, vi } from "vitest";
import { readPlanningRunAction, cancelPlanningRunAction } from "./planning-actions";
import { readPlanningApprovalAction, preparePlanningApprovalAction, rejectPlanningApprovalAction, applyPlanningApprovalAction } from "./planning-approval-actions";
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
afterEach(() => vi.unstubAllEnvs());
it("requires a real session to read or cancel a planning run", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://planning.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture");
  expect(await readPlanningRunAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await cancelPlanningRunAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await readPlanningApprovalAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await preparePlanningApprovalAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await rejectPlanningApprovalAction("owner", "run")).toEqual({ ok: false, code: "unauthenticated" });
  expect(await applyPlanningApprovalAction("owner", "run", "proposal", 0)).toEqual({ ok: false, code: "unauthenticated" });
});
