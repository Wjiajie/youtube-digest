import { createDeepSeek, type DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import { z } from "zod";
import { publicSupabaseConfig } from "../env";
import type { PlanningWorker } from "./planning-worker";

/** Only imported by server entry points. No implicit activation from the presence of keys. */
export function planningConfiguration() {
  if (process.env.BLUEPRINT_PLANNING_ENABLED !== "true") return null;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const workerKey = process.env.BLUEPRINT_PLANNING_WORKER_SECRET?.trim();
  if (!apiKey || !workerKey || workerKey.length < 32 || /^sb_(secret|publishable)_/.test(workerKey)
    || /^[^.]+\.[^.]+\.[^.]+$/.test(workerKey)) return null;
  try { return { ...publicSupabaseConfig(), apiKey, workerKey }; } catch { return null; }
}

/** The fetch seam is for SDK integration tests; no runtime proxy URL or model override. */
export function createPlanningModel(apiKey: string, fetch?: DeepSeekProviderSettings["fetch"]) {
  return createDeepSeek({ apiKey, fetch })("deepseek-v4-flash");
}

const receiptSchema = z.strictObject({ data: z.unknown(), error: z.strictObject({ code: z.string(), message: z.string() }).nullable() });

export function createPlanningWorker(configuration: NonNullable<ReturnType<typeof planningConfiguration>>,
  accessToken: string, fetcher: typeof fetch = fetch): PlanningWorker {
  async function call(body: object) {
    try {
      const response = await fetcher(`${configuration.url}/functions/v1/planning-worker`, {
        method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", apikey: configuration.publishableKey,
          Authorization: `Bearer ${accessToken}`, "x-blueprint-worker-secret": configuration.workerKey },
        body: JSON.stringify(body),
      });
      const receipt = receiptSchema.safeParse(await response.json());
      if (!receipt.success || (!response.ok && !receipt.data.error)) throw new Error("invalid_worker_receipt");
      return receipt.data;
    } catch { return { data: null, error: { code: "unavailable", message: "unavailable" } }; }
  }
  return { claim: input => call({ operation: "claim", ...input }), finish: input => call({ operation: "finish", ...input }) };
}
