import { workerConfiguration, workerTransport } from "./worker-transport";
import { createTranslationWorkerAdapter } from "./translation-run-worker";

/** Translation needs its own explicit opt-in and credential, not a resource-stage opt-in. */
export function translationConfiguration() {
  const base = workerConfiguration("translation");
  if (!base || [base.publishableKey, base.apiKey, process.env.YOUTUBE_API_KEY?.trim(), process.env.SUPADATA_API_KEY?.trim(),
    process.env.BLUEPRINT_PLANNING_WORKER_SECRET?.trim(), process.env.BLUEPRINT_CLARIFICATION_WORKER_SECRET?.trim(),
    process.env.BLUEPRINT_RESOURCE_WORKER_SECRET?.trim()].includes(base.workerKey)) return null;
  return base;
}

export function createRemoteTranslationWorker(configuration: { url: string; publishableKey: string; workerKey: string },
  accessToken: string, ownerId: string, fetcher: typeof fetch = fetch) {
  const call = workerTransport("translation", configuration, accessToken, fetcher);
  return createTranslationWorkerAdapter({
    claim: input => call({ operation: "claim", ...input }),
    finish: input => call({ operation: "finish", ...input }),
  }, ownerId);
}
