import { z } from "zod";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import type { ResourceProvider, TranscriptResult, VideoMetadata } from "./types";

export const resourcePreferencesSchema = z.strictObject({
  regionCode: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/),
  allowLanguageFallback: z.boolean(),
  maxDurationSeconds: z.int().positive().max(86_400),
  publishedAfter: z.iso.datetime({ offset: true }).nullable(),
});
const requestSchema = z.strictObject({
  blueprint: blueprintSnapshotSchema, nodeId: z.uuid(), preferences: resourcePreferencesSchema, signal: z.instanceof(AbortSignal),
});
type Candidate = { video: VideoMetadata; url: string; transcript: TranscriptResult;
  languageFallback: boolean | null; eligibleForMatching: boolean; matching: "not_evaluated" };
function exclusion(video: VideoMetadata, preferences: z.infer<typeof resourcePreferencesSchema>, checkedAt: string) {
  if (video.privacyStatus !== "public") return "not_public";
  if (video.uploadStatus !== "processed") return "not_processed";
  if (video.liveBroadcastContent !== "none") return "live_or_upcoming";
  if (video.blockedRegions.includes(preferences.regionCode) ||
    (video.allowedRegions !== null && !video.allowedRegions.includes(preferences.regionCode))) return "region_restricted";
  if (video.ageRestricted) return "age_restricted";
  if (video.durationSeconds > preferences.maxDurationSeconds) return "duration_exceeded";
  if (Date.parse(video.publishedAt) > Date.parse(checkedAt)) return "future_publication";
  if (preferences.publishedAfter && Date.parse(video.publishedAt) < Date.parse(preferences.publishedAfter)) return "before_requested_date";
  return null;
}

/** Internal server module. The caller must obtain the current snapshot through authenticated storage. */
export function createResourceDiscovery(dependencies: { provider: ResourceProvider; now?: () => Date }) {
  return {
    async run(input: unknown) {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) return { status: "invalid_input" as const };
      const { blueprint, nodeId, preferences, signal } = parsed.data;
      const node = blueprint.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes)).find(node => node.id === nodeId);
      if (!node) return { status: "invalid_input" as const };
      if (node.type !== "learn") return { status: "not_applicable" as const };
      const requests = { catalogMayHaveRun: false, transcriptVideoIds: [] as string[] };
      if (signal.aborted) return { status: "cancelled" as const, requests };
      try {
        const checkedAt = (dependencies.now?.() ?? new Date()).toISOString();
        const source = { blueprintId: blueprint.id, blueprintVersion: blueprint.version, nodeId, checkedAt };
        const query = `${node.title} ${node.description ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 240);
        requests.catalogMayHaveRun = true;
        const catalog = await dependencies.provider.search({ query, regionCode: preferences.regionCode, relevanceLanguage: preferences.language }, signal);
        if (signal.aborted) return { status: "cancelled" as const, requests };
        if (catalog.status !== "ready") return { status: catalog.status, requests };
        const rejected: { videoId: string; reason: NonNullable<ReturnType<typeof exclusion>> }[] = [];
        const available = catalog.videos.filter(video => {
          const reason = exclusion(video, preferences, checkedAt);
          if (reason) rejected.push({ videoId: video.videoId, reason });
          return !reason;
        });
        if (!available.length) return { status: "no_candidates" as const, source, requests, rejected };
        const candidates: Candidate[] = [];
        for (const video of available.slice(0, 3)) {
          requests.transcriptVideoIds.push(video.videoId);
          const transcript = await dependencies.provider.nativeTranscript(video.videoId, preferences.language, signal);
          if (signal.aborted) return { status: "cancelled" as const, requests };
          const languageFallback = transcript.status === "ready" ? transcript.language.toLowerCase() !== preferences.language.toLowerCase() : null;
          candidates.push({ video, url: `https://www.youtube.com/watch?v=${video.videoId}`, transcript, languageFallback,
            eligibleForMatching: transcript.status === "ready" && (!languageFallback || preferences.allowLanguageFallback), matching: "not_evaluated" });
        }
        return { status: "discovered" as const, source, requests, candidates, rejected, uninspectedVideoIds: available.slice(3).map(video => video.videoId) };
      } catch {
        return { status: signal.aborted ? "cancelled" as const : "unavailable" as const, requests };
      }
    },
  };
}
