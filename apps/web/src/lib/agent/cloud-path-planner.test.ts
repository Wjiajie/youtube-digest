import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { createCloudPathPlanner } from "./cloud-path-planner";

describe("cloud planner local preflight", () => {
  it("rejects extension callers before any database or model work", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
    const client = createClient("http://127.0.0.1:54321", "test-only-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const model = new MockLanguageModelV4();
    const service = createCloudPathPlanner({ client, workerClient: client, model,
      actor: { userId: "10000000-0000-4000-8000-000000000001", client: "extension" } });
    expect(await service.run({}, new AbortController().signal)).toEqual({ ok: false, code: "forbidden" });
    expect(await service.read("invalid")).toEqual({ ok: false, code: "forbidden" });
    expect(await service.cancel("invalid")).toEqual({ ok: false, code: "forbidden" });
    expect(fetch).not.toHaveBeenCalled(); expect(model.doGenerateCalls).toHaveLength(0);
  });
});
