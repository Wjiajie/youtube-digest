import { z } from "zod";
import type { ResourceProvider, TranscriptResult, VideoMetadata } from "./types";
import { requestProviderJson } from "./provider-http";

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/);
const region = z.string().regex(/^[A-Z]{2}$/);
const searchInput = z.object({ query: z.string().trim().min(1).max(500), regionCode: region, relevanceLanguage: language });
const duration = z.string().transform((value, context) => {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  const seconds = match ? Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0) : NaN;
  if (!match || !match.slice(1).some(Boolean) || !Number.isSafeInteger(seconds) || seconds < 0 || value.endsWith("T")) {
    context.addIssue({ code: "custom", message: "Invalid duration" }); return z.NEVER;
  }
  return seconds;
});
const count = z.unknown().optional().transform(value => typeof value === "string" && /^\d+$/.test(value) ? value : null);
const metadata = z.object({
  id: videoId,
  snippet: z.object({ title: z.string().min(1), description: z.string(), channelId: z.string().min(1), channelTitle: z.string().min(1), publishedAt: z.iso.datetime({ offset: true }),
    liveBroadcastContent: z.enum(["none", "live", "upcoming"]), defaultAudioLanguage: language.optional(), defaultLanguage: language.optional() }),
  contentDetails: z.object({ duration, caption: z.enum(["true", "false"]), regionRestriction: z.object({ allowed: z.array(region).optional(), blocked: z.array(region).optional() }).optional(),
    contentRating: z.object({ ytRating: z.literal("ytAgeRestricted").optional() }).optional() }),
  status: z.object({ privacyStatus: z.enum(["public", "unlisted", "private"]), uploadStatus: z.enum(["processed", "uploaded", "failed", "rejected", "deleted"]), embeddable: z.boolean() }),
  statistics: z.object({ viewCount: count, likeCount: count, commentCount: count }).optional(),
}).transform((value): VideoMetadata => ({
  videoId: value.id, title: value.snippet.title, description: value.snippet.description, channelId: value.snippet.channelId, channelTitle: value.snippet.channelTitle, publishedAt: value.snippet.publishedAt,
  durationSeconds: value.contentDetails.duration, audioLanguage: value.snippet.defaultAudioLanguage ?? null, defaultLanguage: value.snippet.defaultLanguage ?? null,
  captionAvailable: value.contentDetails.caption === "true", privacyStatus: value.status.privacyStatus, uploadStatus: value.status.uploadStatus,
  liveBroadcastContent: value.snippet.liveBroadcastContent, embeddable: value.status.embeddable,
  allowedRegions: value.contentDetails.regionRestriction?.allowed ?? null, blockedRegions: value.contentDetails.regionRestriction?.blocked ?? [],
  ageRestricted: value.contentDetails.contentRating?.ytRating === "ytAgeRestricted",
  statistics: value.statistics ?? { viewCount: null, likeCount: null, commentCount: null },
}));
const collection = z.object({ items: z.array(z.unknown()) });
const searchItem = z.object({ id: z.object({ kind: z.literal("youtube#video"), videoId }) });
const jobId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const transcript = z.object({
  lang: language, availableLangs: z.array(language),
  content: z.array(z.object({ text: z.string().trim().min(1), offset: z.number().min(0).max(Number.MAX_SAFE_INTEGER), duration: z.number().min(0).max(Number.MAX_SAFE_INTEGER), lang: language.optional() })
    .refine(segment => Number.isFinite(segment.offset + segment.duration) && segment.offset + segment.duration <= Number.MAX_SAFE_INTEGER)).min(1),
});
function parseTranscript(data: unknown): TranscriptResult {
  const result = transcript.safeParse(data);
  return result.success ? { status: "ready", language: result.data.lang, availableLanguages: result.data.availableLangs, segments: result.data.content } : { status: "unavailable" };
}

/** A fresh, exact-ID metadata lookup; it cannot search or initiate subtitle jobs. */
export function createVideoLookup(config: { youtubeApiKey?: string; fetch?: typeof fetch }) {
  return async (id: string, signal: AbortSignal) => {
    if (signal.aborted) return { status: "cancelled" as const };
    if (!videoId.safeParse(id).success) return { status: "invalid_input" as const };
    if (!config.youtubeApiKey?.trim()) return { status: "unavailable" as const };
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.search = new URLSearchParams({ part: "snippet,contentDetails,status", id, key: config.youtubeApiKey }).toString();
    const response = await requestProviderJson(config.fetch ?? globalThis.fetch, url, {}, signal);
    if (!response.ok) return response.failure;
    const data = collection.safeParse(response.data);
    if (!data.success || response.status !== 200 || data.data.items.length > 1) return { status: "unavailable" as const };
    if (!data.data.items.length) return { status: "not_found" as const };
    const parsed = metadata.safeParse(data.data.items[0]);
    if (!parsed.success || parsed.data.videoId !== id) return { status: "unavailable" as const };
    return { status: "ready" as const, video: parsed.data };
  };
}

/** Fixed provider origins; credentials are supplied by a server caller, never read from the environment. */
export function createResourceProvider(config: { youtubeApiKey?: string; supadataApiKey?: string; fetch?: typeof fetch }): ResourceProvider {
  const fetcher = config.fetch ?? globalThis.fetch;
  return {
    async search(input, signal) {
      if (signal.aborted) return { status: "cancelled" };
      const parsed = searchInput.safeParse(input);
      if (!parsed.success) return { status: "invalid_input" };
      if (!config.youtubeApiKey?.trim()) return { status: "unavailable" };
      try {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.search = new URLSearchParams({ part: "snippet", type: "video", order: "relevance", safeSearch: "strict", maxResults: "10", q: parsed.data.query, relevanceLanguage: parsed.data.relevanceLanguage, regionCode: parsed.data.regionCode, key: config.youtubeApiKey }).toString();
        const response = await requestProviderJson(fetcher, url, {}, signal);
        if (!response.ok) return response.failure;
        const results = collection.safeParse(response.data);
        if (!results.success) return { status: "unavailable" };
        const ids = [...new Set(results.data.items.slice(0, 10).flatMap(item => { const parsed = searchItem.safeParse(item); return parsed.success ? [parsed.data.id.videoId] : []; }))];
        if (!ids.length) return { status: "ready", videos: [] };
        const details = new URL("https://www.googleapis.com/youtube/v3/videos");
        details.search = new URLSearchParams({ part: "snippet,contentDetails,status,statistics", id: ids.join(","), key: config.youtubeApiKey }).toString();
        const detailResponse = await requestProviderJson(fetcher, details, {}, signal);
        if (!detailResponse.ok) return detailResponse.failure;
        const data = collection.safeParse(detailResponse.data);
        if (!data.success) return { status: "unavailable" };
        const videos = new Map<string, VideoMetadata>();
        for (const item of data.data.items) {
          const parsed = metadata.safeParse(item);
          if (parsed.success && ids.includes(parsed.data.videoId) && !videos.has(parsed.data.videoId)) videos.set(parsed.data.videoId, parsed.data);
        }
        return { status: "ready", videos: ids.flatMap(id => { const item = videos.get(id); return item ? [item] : []; }) };
      } catch { return { status: "unavailable" }; }
    },
    async nativeTranscript(id, preferredLanguage, signal) {
      if (signal.aborted) return { status: "cancelled" };
      if (!videoId.safeParse(id).success || !language.safeParse(preferredLanguage).success) return { status: "invalid_input" };
      if (!config.supadataApiKey?.trim()) return { status: "unavailable" };
      const url = new URL("https://api.supadata.ai/v1/transcript");
      url.search = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, lang: preferredLanguage, mode: "native", text: "false" }).toString();
      try {
        const response = await requestProviderJson(fetcher, url, { "x-api-key": config.supadataApiKey }, signal);
        if (!response.ok) return response.failure;
        const data = response.data;
        if (response.status === 202) {
          const job = z.object({ jobId }).safeParse(data);
          return job.success ? { status: "pending", jobId: job.data.jobId } : { status: "unavailable" };
        }
        return parseTranscript(data);
      } catch { return { status: "unavailable" }; }
    },
    async transcriptJob(id, signal) {
      if (signal.aborted) return { status: "cancelled" };
      if (!jobId.safeParse(id).success) return { status: "invalid_input" };
      if (!config.supadataApiKey?.trim()) return { status: "unavailable" };
      try {
        const response = await requestProviderJson(fetcher, new URL(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(id)}`), { "x-api-key": config.supadataApiKey }, signal);
        if (!response.ok) return response.failure;
        const data = response.data;
        const job = z.object({ status: z.enum(["queued", "active", "completed", "failed"]) }).safeParse(data);
        if (!job.success || job.data.status === "failed") return { status: "unavailable" };
        return job.data.status === "completed" ? parseTranscript(data) : { status: "pending", jobId: id };
      } catch { return { status: "unavailable" }; }
    },
  };
}
