import { expect, test } from "vitest";
import { createResourceDiscovery } from "./discovery";
import { resumeResourceCaptions } from "./caption-resume";
import type { ResourceProvider, VideoMetadata } from "./types";

const video: VideoMetadata = { videoId: "abcdefghijk", title: "曝光", description: "快门基础", channelId: "channel", channelTitle: "摄影",
  publishedAt: "2020-01-01T00:00:00Z", durationSeconds: 120, audioLanguage: "zh", defaultLanguage: null, captionAvailable: true,
  privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: false, allowedRegions: null,
  blockedRegions: [], ageRestricted: false, statistics: { viewCount: null, likeCount: null, commentCount: null } };
const preferences = { regionCode: "US", language: "zh", allowLanguageFallback: false, maxDurationSeconds: 300, publishedAfter: null };
const nodeId = "11000000-0000-4000-8000-000000000004";
const blueprint = { schemaVersion: 1, id: "11000000-0000-4000-8000-000000000001", version: 2, title: "蓝图",
  goals: [{ id: "11000000-0000-4000-8000-000000000002", title: "摄影", position: 0, stages: [{ id: "11000000-0000-4000-8000-000000000003",
    title: "基础", position: 0, nodes: [{ id: nodeId, title: "曝光", type: "learn", position: 0, dependencyIds: [], resources: [] }] }] }] };

test("an explicit caption continuation reads the existing job once without restarting discovery or mutating saved evidence", async () => {
  const calls: string[] = [];
  const provider: ResourceProvider = {
    async search() { calls.push("search"); return { status: "ready", videos: [video] }; },
    async nativeTranscript() { calls.push("native"); return { status: "pending", jobId: "saved-job" }; },
    async transcriptJob(id) { calls.push(id); return { status: "ready", language: "en", availableLanguages: ["en"], segments: [{ text: "Exposure", offset: 100, duration: 200 }] }; },
  };
  const signal = new AbortController().signal;
  const discovered = await createResourceDiscovery({ provider }).run({ blueprint, nodeId, preferences, signal });
  const before = structuredClone(discovered);
  const result = await resumeResourceCaptions({ discovery: discovered, preferences, signal }, provider);
  expect(result).toMatchObject({ status: "discovered", candidates: [{ transcript: { status: "ready", language: "en" }, languageFallback: true, eligibleForMatching: false }] });
  expect(calls).toEqual(["search", "native", "saved-job"]);
  expect(discovered).toEqual(before);
  if (result.status !== "discovered" || discovered.status !== "discovered") throw new Error("Expected discovery");
  expect(result.source).toEqual(discovered.source);
});

test("two different videos cannot share one pending job and masquerade as independent caption evidence", async () => {
  const calls: string[] = [];
  const provider: ResourceProvider = {
    async search() { return { status: "ready", videos: [video, { ...video, videoId: "lmnopqrstuv" }] }; },
    async nativeTranscript() { return { status: "pending", jobId: "duplicated-job" }; },
    async transcriptJob(id) { calls.push(id); return { status: "pending", jobId: id }; },
  };
  const signal = new AbortController().signal;
  const discovery = await createResourceDiscovery({ provider }).run({ blueprint, nodeId, preferences, signal });
  expect(await resumeResourceCaptions({ discovery, preferences, signal }, provider)).toEqual({ status: "invalid_input" });
  expect(calls).toEqual([]);
});

test.each(["pending", "wrong_job", "throw", "cancel"] as const)("caption continuation handles %s without polling or starting captions", async mode => {
  const controller = new AbortController(), reads: string[] = [];
  const provider: ResourceProvider = {
    async search() { return { status: "ready", videos: [video, { ...video, videoId: "lmnopqrstuv" }] }; },
    async nativeTranscript(id) { return { status: "pending", jobId: id }; },
    async transcriptJob(id) {
      reads.push(id);
      if (mode === "throw") throw new Error("PRIVATE_PROVIDER_ERROR");
      if (mode === "cancel") controller.abort("PRIVATE_REASON");
      return { status: "pending", jobId: mode === "wrong_job" ? "another-job" : id };
    },
  };
  const discovery = await createResourceDiscovery({ provider }).run({ blueprint, nodeId, preferences, signal: controller.signal });
  const before = structuredClone(discovery);
  const result = await resumeResourceCaptions({ discovery, preferences, signal: controller.signal }, provider);
  expect(result.status).toBe({ pending: "discovered", wrong_job: "invalid_output", throw: "unavailable", cancel: "cancelled" }[mode]);
  expect(reads).toEqual(mode === "pending" ? [video.videoId, "lmnopqrstuv"] : [video.videoId]);
  expect(discovery).toEqual(before);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});

test("already ready captions are retained verbatim while a pending candidate is checked", async () => {
  const reads: string[] = [];
  const provider: ResourceProvider = {
    async search() { return { status: "ready", videos: [video, { ...video, videoId: "lmnopqrstuv" }] }; },
    async nativeTranscript(id) { return id === video.videoId ? { status: "ready", language: "zh", availableLanguages: ["zh"], segments: [{ text: " 曝光原文 ", offset: 100, duration: 200 }] } : { status: "pending", jobId: "job" }; },
    async transcriptJob(id) { reads.push(id); return { status: "not_found" }; },
  };
  const signal = new AbortController().signal;
  const discovery = await createResourceDiscovery({ provider }).run({ blueprint, nodeId, preferences, signal });
  const result = await resumeResourceCaptions({ discovery, preferences, signal }, provider);
  if (result.status !== "discovered" || discovery.status !== "discovered") throw new Error("Expected discovery");
  expect(result.candidates[0]).toEqual(discovery.candidates[0]);
  expect(result.candidates[1]).toMatchObject({ transcript: { status: "not_found" }, languageFallback: null, eligibleForMatching: false });
  expect(reads).toEqual(["job"]);
});
