import { z } from "zod";
import { createVideoLookup } from "./provider";
import { resourceExclusion, resourcePreferencesSchema } from "./discovery";
import { discoveredResourcesSchema } from "./evidence";

const inputSchema = z.strictObject({ original: discoveredResourcesSchema.shape.candidates.element.shape.video,
  preferences: resourcePreferencesSchema, signal: z.instanceof(AbortSignal) });
export const videoVerificationSchema = z.union([
  z.strictObject({ status: z.literal("verified"), video: z.strictObject({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string().min(1).max(500), channelTitle: z.string().min(1).max(500), publishedAt: z.iso.datetime({ offset: true }), durationSeconds: z.int().min(1).max(86400) }) }),
  z.strictObject({ status: z.enum(["unavailable", "not_found", "not_available", "changed", "invalid_input", "rate_limited", "cancelled", "timed_out"]) }),
]);
export type VideoVerification = z.infer<typeof videoVerificationSchema>;

/** Availability evidence for a selected matched video, never a claim that playback or learning is guaranteed. */
export function createVideoVerification(config: { youtubeApiKey?: string; fetch?: typeof fetch; now?: () => Date }) {
  const lookup = createVideoLookup(config);
  return { async run(input: unknown): Promise<VideoVerification> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_input" };
    const { original, preferences, signal } = parsed.data;
    try {
      const result = await lookup(original.videoId, signal);
      if (signal.aborted) return { status: "cancelled" };
      if (result.status !== "ready") return result;
      if (resourceExclusion(result.video, preferences, (config.now?.() ?? new Date()).toISOString())) return { status: "not_available" };
      const evidenceFields = ["title", "description", "channelId", "channelTitle", "publishedAt", "durationSeconds", "audioLanguage", "defaultLanguage", "captionAvailable"] as const;
      if (evidenceFields.some(field => result.video[field] !== original[field])) return { status: "changed" };
      const { videoId, title, channelTitle, publishedAt, durationSeconds } = result.video;
      const receipt = videoVerificationSchema.safeParse({ status: "verified", video: { videoId, title, channelTitle, publishedAt, durationSeconds } });
      return receipt.success ? receipt.data : { status: "unavailable" };
    } catch { return { status: signal.aborted ? "cancelled" : "unavailable" }; }
  } };
}
