import type { ResourceWorker } from "./resource-worker";
import { workerConfiguration, workerTransport } from "./worker-transport";

/** A separate explicit opt-in. No credentials, flags or admin keys inherited from other stages. */
export function resourceConfiguration() {
  const base = workerConfiguration("resource");
  const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
  const supadataApiKey = process.env.SUPADATA_API_KEY?.trim();
  if (!base || !youtubeApiKey || !supadataApiKey) return null;
  if ([base.publishableKey, base.apiKey, youtubeApiKey, supadataApiKey,
    process.env.BLUEPRINT_PLANNING_WORKER_SECRET?.trim(), process.env.BLUEPRINT_CLARIFICATION_WORKER_SECRET?.trim()].includes(base.workerKey)) return null;
  return { ...base, youtubeApiKey, supadataApiKey };
}

export function createResourceWorker(configuration: NonNullable<ReturnType<typeof resourceConfiguration>>,
  accessToken: string, fetcher: typeof fetch = fetch): ResourceWorker {
  const call = workerTransport("resource", configuration, accessToken, fetcher);
  return { claim: input => call({ operation: "claim", ...input }), finish: input => call({ operation: "finish", ...input }) };
}
