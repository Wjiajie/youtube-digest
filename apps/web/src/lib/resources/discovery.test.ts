import { describe, expect, it, vi } from "vitest";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import { createResourceDiscovery } from "./discovery";
import type { ResourceProvider, VideoMetadata, NativeTranscript } from "./types";

const nodeId = "10000000-0000-4000-8000-000000000004";
function request() {
  return { nodeId, signal: new AbortController().signal,
    blueprint: blueprintSnapshotSchema.parse({ schemaVersion: 2, id: "10000000-0000-4000-8000-000000000001", version: 4, title: "PRIVATE_BLUEPRINT",
      goals: [{ id: "10000000-0000-4000-8000-000000000002", title: "PRIVATE_GOAL", position: 0,
        stages: [{ id: "10000000-0000-4000-8000-000000000003", title: "基础", position: 0,
          nodes: [{ id: nodeId, title: "比较摄影曝光组合", description: "理解快门与光圈", type: "learn", position: 0,
            estimatedMinutes: 30, completionCriteria: "记录三组曝光差异", dependencyIds: [], resources: [] }] }] }] }),
    preferences: { regionCode: "US", language: "zh-Hans", allowLanguageFallback: true, maxDurationSeconds: 1800, publishedAfter: null },
  };
}
function provider(): ResourceProvider {
  return { search: vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [] })),
    nativeTranscript: vi.fn<ResourceProvider["nativeTranscript"]>(async () => ({ status: "not_found" })),
    transcriptJob: vi.fn<ResourceProvider["transcriptJob"]>(async () => ({ status: "pending", jobId: "existing-job" })),
  };
}
function video(index = 0, patch: Partial<VideoMetadata> = {}): VideoMetadata {
  return { videoId: `video00000${index}`, title: "曝光基础", description: "PRIVATE_DESCRIPTION", channelId: "channel-id", channelTitle: "摄影课堂",
    publishedAt: "2015-01-01T00:00:00Z", durationSeconds: 600, audioLanguage: "en", defaultLanguage: "en", captionAvailable: true,
    privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: false,
    allowedRegions: null, blockedRegions: [], ageRestricted: false,
    statistics: { viewCount: "9007199254740993", likeCount: null, commentCount: "0" }, ...patch };
}
const transcript: NativeTranscript = { status: "ready", language: "en", availableLanguages: ["en"],
  segments: [{ text: "Compare aperture and shutter speed.", offset: 1000, duration: 2500, lang: "en" }] };
const now = () => new Date("2026-09-10T00:00:00Z");

describe("source-bound learning resource discovery", () => {
  it("rejects missing nodes, malformed preferences and non-learning nodes without requesting external data", async () => {
    const external = provider();
    const discovery = createResourceDiscovery({ provider: external });
    expect(await discovery.run({ ...request(), nodeId: "20000000-0000-4000-8000-000000000004" })).toMatchObject({ status: "invalid_input" });
    expect(await discovery.run({ ...request(), preferences: { ...request().preferences, regionCode: "US&key=private" } })).toMatchObject({ status: "invalid_input" });
    const practice = request(); practice.blueprint.goals[0].stages[0].nodes[0].type = "practice";
    expect(await discovery.run(practice)).toMatchObject({ status: "not_applicable" });
    expect(external.search).not.toHaveBeenCalled();
    expect(external.nativeTranscript).not.toHaveBeenCalled();
  });

  it("discovers only three search-ordered candidates, retains actual caption language and raw signals, and never changes the Blueprint", async () => {
    const external = provider();
    external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video(0), video(1), video(2), video(3)] }));
    external.nativeTranscript = vi.fn(async () => transcript);
    const input = request(), before = structuredClone(input.blueprint);
    const result = await createResourceDiscovery({ provider: external, now }).run(input);
    expect(result.status).toBe("discovered");
    if (result.status !== "discovered") throw new Error("Expected discovered evidence");
    expect(result.source).toEqual({ blueprintId: input.blueprint.id, blueprintVersion: 4, nodeId, checkedAt: "2026-09-10T00:00:00.000Z" });
    expect(result.candidates.map(item => item.video.videoId)).toEqual(["video000000", "video000001", "video000002"]);
    expect(result.candidates[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=video000000", transcript,
      languageFallback: true, eligibleForMatching: true, matching: "not_evaluated" });
    expect(result.candidates[0].video.statistics).toEqual({ viewCount: "9007199254740993", likeCount: null, commentCount: "0" });
    expect(result.uninspectedVideoIds).toEqual(["video000003"]);
    expect(result.requests).toEqual({ catalogMayHaveRun: true, transcriptVideoIds: ["video000000", "video000001", "video000002"] });
    expect(external.search).toHaveBeenCalledExactlyOnceWith({ query: "比较摄影曝光组合 理解快门与光圈", regionCode: "US", relevanceLanguage: "zh-Hans" }, input.signal);
    expect(external.transcriptJob).not.toHaveBeenCalled();
    expect(input.blueprint).toEqual(before);
  });

  it.each<{ patch: Partial<VideoMetadata>; reason: string }>([
    { patch: { privacyStatus: "private" }, reason: "not_public" },
    { patch: { privacyStatus: "unlisted" }, reason: "not_public" },
    { patch: { uploadStatus: "uploaded" }, reason: "not_processed" },
    { patch: { liveBroadcastContent: "live" }, reason: "live_or_upcoming" },
    { patch: { liveBroadcastContent: "upcoming" }, reason: "live_or_upcoming" },
    { patch: { blockedRegions: ["US"] }, reason: "region_restricted" },
    { patch: { allowedRegions: [] }, reason: "region_restricted" },
    { patch: { allowedRegions: ["GB"] }, reason: "region_restricted" },
    { patch: { ageRestricted: true }, reason: "age_restricted" },
    { patch: { durationSeconds: 1801 }, reason: "duration_exceeded" },
    { patch: { publishedAt: "2027-01-01T00:00:00Z" }, reason: "future_publication" },
  ])("does not request captions for $reason metadata", async ({ patch, reason }) => {
    const external = provider();
    external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video(0, patch), video(1, { allowedRegions: ["US"] })] }));
    external.nativeTranscript = vi.fn(async () => transcript);
    const result = await createResourceDiscovery({ provider: external, now }).run(request());
    expect(result.status).toBe("discovered");
    if (result.status !== "discovered") throw new Error("Expected discovered evidence");
    expect(result.candidates.map(item => item.video.videoId)).toEqual(["video000001"]);
    expect(result.rejected).toEqual([{ videoId: "video000000", reason }]);
    expect(result.requests.transcriptVideoIds).toEqual(["video000001"]);
  });

  it("uses an explicit freshness requirement without treating old foundational content as inherently worse", async () => {
    const external = provider(); external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video(0)] }));
    const result = await createResourceDiscovery({ provider: external, now }).run({ ...request(), preferences: { ...request().preferences, publishedAfter: "2025-01-01T00:00:00Z" } });
    expect(result).toMatchObject({ status: "no_candidates", rejected: [{ videoId: "video000000", reason: "before_requested_date" }] });
    expect(external.nativeTranscript).not.toHaveBeenCalled();
  });

  it("does not dispatch a cancelled request or use late catalog evidence after cancellation", async () => {
    const controller = new AbortController(), external = provider();
    controller.abort();
    const discovery = createResourceDiscovery({ provider: external, now });
    expect(await discovery.run({ ...request(), signal: controller.signal })).toMatchObject({ status: "cancelled", requests: { catalogMayHaveRun: false, transcriptVideoIds: [] } });
    expect(external.search).not.toHaveBeenCalled();
    const active = new AbortController();
    external.search = vi.fn<ResourceProvider["search"]>(async () => { active.abort(); return { status: "ready", videos: [video()] }; });
    expect(await discovery.run({ ...request(), signal: active.signal })).toMatchObject({ status: "cancelled", requests: { catalogMayHaveRun: true, transcriptVideoIds: [] } });
    expect(external.nativeTranscript).not.toHaveBeenCalled();
  });

  it("stops between transcript requests and discards a late successful transcript after cancellation", async () => {
    const controller = new AbortController(), external = provider();
    external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video(0), video(1), video(2)] }));
    external.nativeTranscript = vi.fn(async () => { controller.abort(); return transcript; });
    expect(await createResourceDiscovery({ provider: external, now }).run({ ...request(), signal: controller.signal }))
      .toEqual({ status: "cancelled", requests: { catalogMayHaveRun: true, transcriptVideoIds: ["video000000"] } });
    expect(external.nativeTranscript).toHaveBeenCalledTimes(1);
  });

  it("keeps pending, absent and disallowed-language captions ineligible without inventing replacements or polling", async () => {
    const external = provider();
    external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video(0), video(1), video(2), video(3)] }));
    external.nativeTranscript = vi.fn<ResourceProvider["nativeTranscript"]>()
      .mockResolvedValueOnce({ status: "pending", jobId: "existing-job" })
      .mockResolvedValueOnce({ status: "not_found" }).mockResolvedValueOnce(transcript);
    const result = await createResourceDiscovery({ provider: external, now }).run({ ...request(), preferences: { ...request().preferences, allowLanguageFallback: false } });
    expect(result.status).toBe("discovered");
    if (result.status !== "discovered") throw new Error("Expected discovered evidence");
    expect(result.candidates.map(candidate => [candidate.transcript.status, candidate.languageFallback, candidate.eligibleForMatching]))
      .toEqual([["pending", null, false], ["not_found", null, false], ["ready", true, false]]);
    expect(result.candidates[0].transcript).toEqual({ status: "pending", jobId: "existing-job" });
    expect(external.nativeTranscript).toHaveBeenCalledTimes(3);
    expect(external.transcriptJob).not.toHaveBeenCalled();
    expect(result.uninspectedVideoIds).toEqual(["video000003"]);
  });

  it("bounds node-only search text and never forwards the Blueprint, Goal, criteria or credentials", async () => {
    const external = provider(), input = request();
    input.blueprint.goals[0].stages[0].nodes[0].description = "  exposure\n\t".repeat(100);
    expect(await createResourceDiscovery({ provider: external, now }).run(input)).toMatchObject({ status: "no_candidates" });
    const [call] = vi.mocked(external.search).mock.calls;
    expect(call[0].query).toHaveLength(240);
    expect(call[0].query).toMatch(/^比较摄影曝光组合 exposure exposure/);
    expect(call[0].query).not.toMatch(/PRIVATE|记录三组曝光差异|\s{2,}/);
    expect(Object.keys(call[0]).sort()).toEqual(["query", "regionCode", "relevanceLanguage"]);
  });

  it.each(["rate_limited", "timed_out", "unavailable", "cancelled", "not_found"] as const)("keeps catalog %s distinct from an empty successful search", async status => {
    const external = provider(); external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status }));
    expect(await createResourceDiscovery({ provider: external, now }).run(request())).toEqual({ status, requests: { catalogMayHaveRun: true, transcriptVideoIds: [] } });
    expect(external.nativeTranscript).not.toHaveBeenCalled();
  });

  it("sanitizes thrown provider failures without losing potentially dispatched request accounting", async () => {
    const external = provider(); external.search = vi.fn<ResourceProvider["search"]>(async () => ({ status: "ready", videos: [video()] }));
    external.nativeTranscript = vi.fn(async () => { throw new Error("PRIVATE_PROVIDER_KEY_AND_BODY"); });
    expect(await createResourceDiscovery({ provider: external, now }).run(request())).toEqual({ status: "unavailable", requests: { catalogMayHaveRun: true, transcriptVideoIds: ["video000000"] } });
    const controller = new AbortController();
    external.search = vi.fn(async () => { controller.abort(); throw new Error("PRIVATE_ABORT_REASON"); });
    expect(await createResourceDiscovery({ provider: external, now }).run({ ...request(), signal: controller.signal })).toEqual({ status: "cancelled", requests: { catalogMayHaveRun: true, transcriptVideoIds: [] } });
  });
});
