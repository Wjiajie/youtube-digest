/** Serializable display contract. No raw captions, jobs, other goals or Skill body. */
export type ResourcePreferences = { regionCode: string; language: string; allowLanguageFallback: boolean; maxDurationSeconds: number; publishedAfter: string | null };
export type ResourceDiscoverCommand = { kind: "discover"; runId: string; nodeId: string; expectedBlueprintVersion: number;
  preferences: ResourcePreferences; learnerContext: { startingPoint: string | null; constraints: string | null } };
export type ResourceUiCommand = ResourceDiscoverCommand | { kind: "captions" | "match"; runId: string; sourceRunId: string };
export type ResourceUiFailure = { ok: false; code: "unauthenticated" | "forbidden" | "invalid" | "not_found" | "version_conflict" |
  "quota_exhausted" | "busy" | "unavailable" | "cancelled" | "input_too_large" | "disabled" };
export type ResourceUiResult<T> = { ok: true; value: T } | ResourceUiFailure;
export type ResourceCandidateView = { videoId: string; url: string; title: string; channel: string; publishedAt: string; durationSeconds: number;
  transcriptStatus: string; language: string | null; languageFallback: boolean | null; eligible: boolean;
  assessment: null | { role: "recommended" | "alternative" | "rejected"; relevance: string; levelFit: string; languageFit: string; timeFit: string; freshness: string;
    limitations: string[]; evidence: { quote: string; offsetMs: number }[]; totalSegments: number; sampledSegments: number; textTruncated: boolean } };
export type ResourceRunView = { id: string; nodeId: string; nodeTitle: string; goalId: string; goalTitle: string; blueprintVersion: number;
  bindings?: { id: string; videoId: string; url: string }[]; adoptions?: { id: string; videoId: string; createdAt: string }[];
  kind: "discover" | "captions" | "match"; sourceRunId: string | null; childId: string | null; nextKind: "captions" | "match" | null;
  status: "queued" | "running" | "ready" | "failed" | "cancelled" | "interrupted" | "stale"; createdAt: string; expiresAt: string;
  preferences: ResourcePreferences; learnerContext: { startingPoint: string | null; constraints: string | null }; skillVersion: string | null;
  result: null | { status: string; summary: string | null; candidates: ResourceCandidateView[]; rejected: { videoId: string; reason: string }[]; uninspectedCount: number } };
export type ResourceNodeView = { nodeId: string; nodeTitle: string; goalId: string; goalTitle: string; blueprintVersion: number;
  description: string | null; completionCriteria: string | null; estimatedMinutes: number | null;
  records: { id: string; kind: "discover" | "captions" | "match"; createdAt: string }[]; offset: number; hasMore: boolean };
export type ResourceRunReviewProps = { accountId: string; initial: ResourceRunView; enabled: boolean; adoptionEnabled?: boolean;
  readAction: () => Promise<ResourceUiResult<ResourceRunView>>;
  cancelAction: () => Promise<ResourceUiResult<ResourceRunView>> };
