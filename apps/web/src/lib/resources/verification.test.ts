import { afterEach, expect, test, vi } from "vitest";
import { createVideoVerification } from "./verification";
import type { VideoMetadata } from "./types";

const original: VideoMetadata = { videoId: "abcdefghijk", title: "Exposure", description: "Practice exposure", channelId: "camera", channelTitle: "Camera",
  publishedAt: "2025-01-02T00:00:00Z", durationSeconds: 300, audioLanguage: "en", defaultLanguage: null, captionAvailable: true,
  privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: false, allowedRegions: null, blockedRegions: [], ageRestricted: false,
  statistics: { viewCount: "100", likeCount: null, commentCount: null } };
const preferences = { regionCode: "US", language: "en", allowLanguageFallback: false, maxDurationSeconds: 1800, publishedAfter: null };
function item() { return { id: "abcdefghijk", snippet: { title: "Exposure", description: "Practice exposure", channelId: "camera", channelTitle: "Camera", publishedAt: "2025-01-02T00:00:00Z", defaultAudioLanguage: "en", liveBroadcastContent: "none" },
  contentDetails: { duration: "PT5M", caption: "true" }, status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false }, statistics: { viewCount: "200" } }; }
function fixture(body: unknown = { items: [item()] }, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const verify = createVideoVerification({ youtubeApiKey: "fixture-only-key", now: () => new Date("2026-09-10T00:00:00Z"),
    fetch: async (input, init) => { calls.push({ url: new URL(String(input)), init }); return Response.json(body, { status }); } });
  return { verify, calls, run: (signal = new AbortController().signal) => verify.run({ original, preferences, signal }) };
}
afterEach(() => vi.useRealTimers());

test("selected-video verification uses one fresh details request, not search, captions or model, and ignores popularity changes", async () => {
  const { run, calls } = fixture();
  expect(await run()).toEqual({ status: "verified", video: { videoId: "abcdefghijk", title: "Exposure", channelTitle: "Camera", publishedAt: "2025-01-02T00:00:00Z", durationSeconds: 300 } });
  expect(calls).toHaveLength(1);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ part: "snippet,contentDetails,status", id: "abcdefghijk", key: "fixture-only-key" });
  expect(calls[0].init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
});

test("a newly region-restricted video cannot be adopted using its old matched evidence", async () => {
  const fresh = item();
  const { run } = fixture({ items: [{ ...fresh, contentDetails: { ...fresh.contentDetails, regionRestriction: { blocked: ["US"] } } }] });
  expect(await run()).toEqual({ status: "not_available" });
});

test("changed teaching metadata requires new matching, rather than silently trusting the old assessment", async () => {
  const fresh = item();
  expect(await fixture({ items: [{ ...fresh, snippet: { ...fresh.snippet, description: "Now this is a different lesson" } }] }).run()).toEqual({ status: "changed" });
});

test.each([
  { items: [] }, { items: [item(), item()] }, { items: [{ ...item(), id: "lmnopqrstuv" }] },
  { items: [{ ...item(), contentDetails: { duration: "garbage", caption: "true" } }] }, { items: "invalid" },
])("missing, mismatched, ambiguous or malformed selected metadata fails closed %#", async body => {
  const { run, calls } = fixture(body);
  expect(await run()).toEqual({ status: Array.isArray(body.items) && body.items.length === 0 ? "not_found" : "unavailable" });
  expect(calls).toHaveLength(1);
});

test.each(["title", "channelId", "channelTitle", "publishedAt", "defaultAudioLanguage"] as const)("a changed %s cannot reuse the original matching decision", async field => {
  const fresh = item();
  const value = field === "publishedAt" ? "2025-01-03T00:00:00Z" : field === "defaultAudioLanguage" ? "fr" : "Different";
  expect(await fixture({ items: [{ ...fresh, snippet: { ...fresh.snippet, [field]: value } }] }).run()).toEqual({ status: "changed" });
});

test.each([
  { ...item(), status: { ...item().status, privacyStatus: "private" } },
  { ...item(), status: { ...item().status, uploadStatus: "deleted" } },
  { ...item(), snippet: { ...item().snippet, liveBroadcastContent: "live" } },
  { ...item(), snippet: { ...item().snippet, publishedAt: "2027-01-01T00:00:00Z" } },
  { ...item(), contentDetails: { ...item().contentDetails, duration: "PT2H" } },
  { ...item(), contentDetails: { ...item().contentDetails, contentRating: { ytRating: "ytAgeRestricted" } } },
  { ...item(), contentDetails: { ...item().contentDetails, regionRestriction: { allowed: [] } } },
])("current availability policy rejects an ineligible video before a confirmation receipt %#", async fresh => {
  expect(await fixture({ items: [fresh] }).run()).toEqual({ status: "not_available" });
});

test("changed duration or native-caption availability invalidates old evidence", async () => {
  for (const details of [{ duration: "PT6M", caption: "true" }, { duration: "PT5M", caption: "false" }])
    expect(await fixture({ items: [{ ...item(), contentDetails: details }] }).run()).toEqual({ status: "changed" });
});

test.each([[429, "rate_limited"], [404, "not_found"], [503, "unavailable"], [202, "unavailable"], [302, "unavailable"]] as const)("HTTP %s is sanitized and never retried", async (code, status) => {
  const { run, calls } = fixture({ private: "fixture-only-key/raw-error" }, code);
  expect(await run()).toEqual({ status }); expect(calls).toHaveLength(1);
});

test("invalid input, absent configuration and pre-cancelled requests cause no provider call", async () => {
  const { verify, calls } = fixture(); const controller = new AbortController(); controller.abort("private reason");
  expect(await verify.run({ original, preferences, signal: controller.signal })).toEqual({ status: "cancelled" });
  expect(await verify.run({ original: { ...original, videoId: "https://evil.example/" }, preferences, signal: new AbortController().signal })).toEqual({ status: "invalid_input" });
  expect(await createVideoVerification({ fetch: async () => { throw new Error("must not call"); } }).run({ original, preferences, signal: new AbortController().signal })).toEqual({ status: "unavailable" });
  expect(calls).toHaveLength(0);
});

test.each(["fetch", "body"])("verification deadline covers stalled %s and does not wait for a cooperative transport", async phase => {
  vi.useFakeTimers();
  const verify = createVideoVerification({ youtubeApiKey: "fixture-key", fetch: async () => phase === "fetch" ? new Promise(() => {}) : new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"items":')); } })) });
  let result: unknown;
  void verify.run({ original, preferences, signal: new AbortController().signal }).then(value => { result = value; });
  await vi.advanceTimersByTimeAsync(9999); expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1); expect(result).toEqual({ status: "timed_out" });
});
