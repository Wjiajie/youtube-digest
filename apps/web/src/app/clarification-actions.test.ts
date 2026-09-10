import { afterEach, expect, it, vi } from "vitest";
import { startClarificationAction, readClarificationAction, readClarificationTurnAction,
  cancelClarificationTurnAction, editClarificationAction, saveClarificationAction } from "./clarification-actions";
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
afterEach(() => vi.unstubAllEnvs());
it("requires a Cookie identity for every clarification workspace operation", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://clarification.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-fixture");
  for (const result of await Promise.all([
    startClarificationAction("owner", {}), readClarificationAction("owner", "session"),
    readClarificationTurnAction("owner", "session", "turn"), cancelClarificationTurnAction("owner", "session", "turn"),
    editClarificationAction("owner", "session", {}), saveClarificationAction("owner", "session", {}),
  ])) expect(result).toEqual({ ok: false, code: "unauthenticated" });
});
