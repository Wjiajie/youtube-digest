import { publicSupabaseConfig } from "../env";
import { workerTransport } from "./worker-transport";
import type { ResourceAdoptionWorker } from "./resource-adoption";

/** Independent opt-in; verification consumes YouTube only, not model or subtitle credits. */
export function resourceAdoptionConfiguration() {
  if (process.env.BLUEPRINT_RESOURCE_ADOPTION_ENABLED !== "true") return null;
  const workerKey = process.env.BLUEPRINT_RESOURCE_WORKER_SECRET?.trim(), youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!youtubeApiKey || !workerKey || workerKey.length < 32 || /^sb_(secret|publishable)_/.test(workerKey) || /^[^.]+\.[^.]+\.[^.]+$/.test(workerKey)) return null;
  try {
    const base = publicSupabaseConfig();
    if ([base.publishableKey, youtubeApiKey, process.env.DEEPSEEK_API_KEY?.trim(), process.env.SUPADATA_API_KEY?.trim(),
      process.env.BLUEPRINT_PLANNING_WORKER_SECRET?.trim(), process.env.BLUEPRINT_CLARIFICATION_WORKER_SECRET?.trim()].includes(workerKey)) return null;
    return { ...base, workerKey, youtubeApiKey };
  } catch { return null; }
}
export function createResourceAdoptionWorker(config: NonNullable<ReturnType<typeof resourceAdoptionConfiguration>>, accessToken: string, fetcher: typeof fetch = fetch): ResourceAdoptionWorker {
  const call = workerTransport("resource", config, accessToken, fetcher);
  return { claim: input => call({ operation: "adoption_claim", ...input }), finish: input => call({ operation: "adoption_finish", ...input }) };
}
