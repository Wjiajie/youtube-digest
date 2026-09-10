import { z } from "zod";

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/);
const region = z.string().regex(/^[A-Z]{2}$/);
const count = z.string().regex(/^\d+$/).max(128).nullable();
const safeNumber = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const resourceSourceSchema = z.strictObject({ blueprintId: z.uuid(), blueprintVersion: z.int().nonnegative(), nodeId: z.uuid(), checkedAt: z.iso.datetime({ offset: true }) });
export const resourceRequestsSchema = z.strictObject({ catalogMayHaveRun: z.boolean(), transcriptVideoIds: z.array(videoId).max(3) });
export const transcriptResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ready"), language, availableLanguages: z.array(language).max(500),
    segments: z.array(z.strictObject({ text: z.string().min(1).max(20000).refine(value => value.trim().length > 0), offset: safeNumber, duration: safeNumber, lang: language.optional() })
      .refine(segment => segment.offset + segment.duration <= Number.MAX_SAFE_INTEGER)).min(1).max(20000) }),
  z.strictObject({ status: z.literal("pending"), jobId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/) }),
  z.strictObject({ status: z.enum(["invalid_input", "unavailable", "rate_limited", "cancelled", "timed_out", "not_found"]) }),
]);
const candidateSchema = z.strictObject({
  video: z.strictObject({ videoId, title: z.string().min(1).max(1000), description: z.string().max(20000),
    channelId: z.string().min(1).max(200), channelTitle: z.string().min(1).max(1000), publishedAt: z.iso.datetime({ offset: true }),
    durationSeconds: z.int().nonnegative(), audioLanguage: language.nullable(), defaultLanguage: language.nullable(), captionAvailable: z.boolean(),
    privacyStatus: z.enum(["public", "unlisted", "private"]), uploadStatus: z.enum(["processed", "uploaded", "failed", "rejected", "deleted"]),
    liveBroadcastContent: z.enum(["none", "live", "upcoming"]), embeddable: z.boolean(), allowedRegions: z.array(region).max(500).nullable(),
    blockedRegions: z.array(region).max(500), ageRestricted: z.boolean(), statistics: z.strictObject({ viewCount: count, likeCount: count, commentCount: count }),
  }),
  url: z.string(), transcript: transcriptResultSchema, languageFallback: z.boolean().nullable(), eligibleForMatching: z.boolean(), matching: z.literal("not_evaluated"),
}).refine(candidate => candidate.url === `https://www.youtube.com/watch?v=${candidate.video.videoId}` &&
  (candidate.transcript.status === "ready" ? candidate.languageFallback !== null : candidate.languageFallback === null && !candidate.eligibleForMatching));
const rejected = z.array(z.strictObject({ videoId, reason: z.enum(["not_public", "not_processed", "live_or_upcoming", "region_restricted", "age_restricted", "duration_exceeded", "future_publication", "before_requested_date"]) })).max(10);
export const discoveredResourcesSchema = z.strictObject({ status: z.literal("discovered"), source: resourceSourceSchema, requests: resourceRequestsSchema,
  candidates: z.array(candidateSchema).min(1).max(3).refine(candidates => {
    const jobs = candidates.flatMap(candidate => candidate.transcript.status === "pending" ? [candidate.transcript.jobId] : []);
    return new Set(candidates.map(candidate => candidate.video.videoId)).size === candidates.length && new Set(jobs).size === jobs.length;
  }),
  rejected, uninspectedVideoIds: z.array(videoId).max(7),
});
export const noCandidatesSchema = z.strictObject({ status: z.literal("no_candidates"), source: resourceSourceSchema, requests: resourceRequestsSchema, rejected });
export type DiscoveredResources = z.infer<typeof discoveredResourcesSchema>;
