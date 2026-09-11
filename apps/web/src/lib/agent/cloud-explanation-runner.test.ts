import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createCloudExplanationRunner } from "./cloud-explanation-runner";
import { createRemoteExplanationWorker } from "./explanation-runtime";
import { createPlanningModel } from "./planning-runtime";

const runId = "10000000-0000-4000-8000-000000000001", ownerId = "30000000-0000-4000-8000-000000000003";
function runnerAtStalledDatabase() {
  const requests: string[] = [];
  const client = createClient("https://database.example.test", "fixture-publishable", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push(String(input));
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error("Local fixture deadline"));
        else init?.signal?.addEventListener("abort", () => reject(new Error("Local fixture deadline")), { once: true });
      });
    } },
  });
  const noExecution: typeof fetch = async () => { throw new Error("Execution not expected"); };
  const worker = createRemoteExplanationWorker({ url: "https://worker.example.test", publishableKey: "fixture-public", workerKey: "fixture-worker" }, "fixture-token", ownerId, noExecution);
  const runner = createCloudExplanationRunner({ client, actor: { userId: ownerId, client: "web" }, worker, model: createPlanningModel("fixture-model", noExecution) });
  return { runner, requests };
}
it("bounds a stalled read as unavailable, not a user cancellation", async () => {
  const { runner, requests } = runnerAtStalledDatabase();
  const result = await runner.read(runId);
  expect(result).toEqual({ ok: false, code: "unavailable" });
  expect(requests).toEqual(["https://database.example.test/rest/v1/rpc/read_explanation_run"]);
}, 12000);
it("honors explicit preflight cancellation without contacting persistence or inference", async () => {
  const { runner, requests } = runnerAtStalledDatabase(), controller = new AbortController(); controller.abort();
  expect(await runner.read(runId, controller.signal)).toEqual({ ok: false, code: "cancelled" });
  expect(await runner.run({}, controller.signal)).toEqual({ ok: false, code: "cancelled" });
  expect(requests).toEqual([]);
});
