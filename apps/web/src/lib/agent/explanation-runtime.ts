import { workerConfiguration, workerTransport } from "./worker-transport";
import { createExplanationWorkerAdapter } from "./explanation-run-worker";

/** Separate opt-in: reading captions or translating never enables explanation. */
export function explanationConfiguration() {
  const base = workerConfiguration("explanation");
  if (!base || [base.publishableKey, base.apiKey, process.env.YOUTUBE_API_KEY?.trim(), process.env.SUPADATA_API_KEY?.trim(),
    process.env.BLUEPRINT_PLANNING_WORKER_SECRET?.trim(), process.env.BLUEPRINT_CLARIFICATION_WORKER_SECRET?.trim(),
    process.env.BLUEPRINT_RESOURCE_WORKER_SECRET?.trim(), process.env.BLUEPRINT_TRANSLATION_WORKER_SECRET?.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(), process.env.SUPABASE_SECRET_KEY?.trim()].includes(base.workerKey)) return null;
  return base;
}

export function createRemoteExplanationWorker(configuration: { url: string; publishableKey: string; workerKey: string },
  accessToken: string, ownerId: string, fetcher: typeof fetch = fetch) {
  const call = workerTransport("explanation", configuration, accessToken, fetcher);
  return createExplanationWorkerAdapter({
    claim: input => call({ operation: "claim", ...input }),
    finish: input => call({ operation: "finish", ...input }),
  }, ownerId);
}
