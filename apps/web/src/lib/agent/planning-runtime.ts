import { createDeepSeek, type DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import type { PlanningWorker } from "./planning-worker";
import { workerConfiguration, workerTransport } from "./worker-transport";

/** Only imported by server entry points. No implicit activation from the presence of keys. */
export function planningConfiguration() {
  return workerConfiguration("planning");
}

/** The fetch seam is for SDK integration tests; no runtime proxy URL or model override. */
export function createPlanningModel(apiKey: string, fetch?: DeepSeekProviderSettings["fetch"]) {
  return createDeepSeek({ apiKey, fetch })("deepseek-v4-flash");
}

export function createPlanningWorker(configuration: NonNullable<ReturnType<typeof planningConfiguration>>,
  accessToken: string, fetcher: typeof fetch = fetch): PlanningWorker {
  const call = workerTransport("planning", configuration, accessToken, fetcher);
  return { claim: input => call({ operation: "claim", ...input }), finish: input => call({ operation: "finish", ...input }) };
}
