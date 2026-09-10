import { z } from "zod";
import { resourcePreferencesSchema } from "./discovery";
import { discoveredResourcesSchema, transcriptResultSchema } from "./evidence";
import type { ResourceProvider } from "./types";

const inputSchema = z.strictObject({ discovery: discoveredResourcesSchema, preferences: resourcePreferencesSchema, signal: z.instanceof(AbortSignal) });

/** Server-owned evidence only. Explicit one-pass job reads, never a new caption request. */
export async function resumeResourceCaptions(input: unknown, provider: ResourceProvider) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid_input" as const };
  const { discovery, preferences, signal } = parsed.data;
  if (!discovery.candidates.some(candidate => candidate.transcript.status === "pending")) return { status: "invalid_input" as const };
  try {
    for (const candidate of discovery.candidates) {
      if (signal.aborted) return { status: "cancelled" as const };
      if (candidate.transcript.status !== "pending") continue;
      const id = candidate.transcript.jobId;
      const transcript = transcriptResultSchema.parse(await provider.transcriptJob(id, signal));
      if (signal.aborted) return { status: "cancelled" as const };
      if (transcript.status === "pending" && transcript.jobId !== id) return { status: "invalid_output" as const };
      candidate.transcript = transcript;
      candidate.languageFallback = transcript.status === "ready" ? transcript.language.toLowerCase() !== preferences.language.toLowerCase() : null;
      candidate.eligibleForMatching = transcript.status === "ready" && (!candidate.languageFallback || preferences.allowLanguageFallback);
    }
    return discovery;
  } catch { return { status: signal.aborted ? "cancelled" as const : "unavailable" as const }; }
}
