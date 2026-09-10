/** Server-side resource evidence. Platform signals are not a teaching-quality score. */
export type ProviderFailure = { status: "invalid_input" | "unavailable" | "rate_limited" | "cancelled" | "timed_out" | "not_found" };
export type VideoMetadata = {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  audioLanguage: string | null;
  defaultLanguage: string | null;
  captionAvailable: boolean;
  privacyStatus: "public" | "unlisted" | "private";
  uploadStatus: "processed" | "uploaded" | "failed" | "rejected" | "deleted";
  liveBroadcastContent: "none" | "live" | "upcoming";
  embeddable: boolean;
  allowedRegions: string[] | null;
  blockedRegions: string[];
  ageRestricted: boolean;
  statistics: { viewCount: string | null; likeCount: string | null; commentCount: string | null };
};
export type SearchRequest = { query: string; regionCode: string; relevanceLanguage: string };
export type CatalogResult = { status: "ready"; videos: VideoMetadata[] } | ProviderFailure;
export type TranscriptSegment = { text: string; offset: number; duration: number; lang?: string };
export type NativeTranscript = {
  status: "ready";
  language: string;
  availableLanguages: string[];
  segments: TranscriptSegment[];
};
export type TranscriptResult = NativeTranscript | { status: "pending"; jobId: string } | ProviderFailure;
export interface ResourceProvider {
  /** One bounded search page, then details only for those returned video IDs. */
  search(input: SearchRequest, signal: AbortSignal): Promise<CatalogResult>;
  /** Existing captions only; never auto/generate. */
  nativeTranscript(videoId: string, language: string, signal: AbortSignal): Promise<TranscriptResult>;
  /** Reads an existing job. Does not initiate another transcript request. */
  transcriptJob(jobId: string, signal: AbortSignal): Promise<TranscriptResult>;
}
