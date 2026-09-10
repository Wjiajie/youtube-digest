import type { ClarificationWorker } from "./clarification-worker";
import { workerConfiguration, workerTransport } from "./worker-transport";

/** Separate opt-in; enabling planning cannot silently enable conversational spending. */
export function clarificationConfiguration() {
  return workerConfiguration("clarification");
}

export function createClarificationWorker(configuration: NonNullable<ReturnType<typeof clarificationConfiguration>>,
  accessToken: string, fetcher: typeof fetch = fetch): ClarificationWorker {
  const call = workerTransport("clarification", configuration, accessToken, fetcher);
  return { claim: input => call({ operation: "claim", ...input }), finish: input => call({ operation: "finish", ...input }) };
}
