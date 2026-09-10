import { z } from "zod";
import { publicSupabaseConfig } from "../env";

type Stage = "planning" | "clarification";
const settings = {
  planning: { enabled: "BLUEPRINT_PLANNING_ENABLED", secret: "BLUEPRINT_PLANNING_WORKER_SECRET" },
  clarification: { enabled: "BLUEPRINT_CLARIFICATION_ENABLED", secret: "BLUEPRINT_CLARIFICATION_WORKER_SECRET" },
} as const;

/** Server-selected stages retain separate opt-ins and credentials. */
export function workerConfiguration(stage: Stage) {
  const setting = settings[stage];
  if (process.env[setting.enabled] !== "true") return null;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const workerKey = process.env[setting.secret]?.trim();
  if (!apiKey || !workerKey || workerKey.length < 32 || /^sb_(secret|publishable)_/.test(workerKey)
    || /^[^.]+\.[^.]+\.[^.]+$/.test(workerKey)) return null;
  try { return { ...publicSupabaseConfig(), apiKey, workerKey }; } catch { return null; }
}

const receiptSchema = z.strictObject({ data: z.unknown(), error: z.strictObject({ code: z.string(), message: z.string() }).nullable() });

/** Shared transport only; each stage adapter owns its typed claim/finish interface. */
export function workerTransport(stage: Stage, configuration: NonNullable<ReturnType<typeof workerConfiguration>>,
  accessToken: string, fetcher: typeof fetch) {
  return async (body: object) => {
    try {
      const response = await fetcher(`${configuration.url}/functions/v1/${stage}-worker`, {
        method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", apikey: configuration.publishableKey,
          Authorization: `Bearer ${accessToken}`, "x-blueprint-worker-secret": configuration.workerKey },
        body: JSON.stringify(body),
      });
      const receipt = receiptSchema.safeParse(await response.json());
      if (!receipt.success || (!response.ok && !receipt.data.error)) throw new Error("Invalid worker receipt");
      return receipt.data;
    } catch { return { data: null, error: { code: "unavailable", message: "unavailable" } }; }
  };
}
