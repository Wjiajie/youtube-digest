import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, test } from "vitest";
import { createResourceDiscovery } from "./discovery";
import { createResourceProvider } from "./provider";

const ids = ["abcdefghijk", "lmnopqrstuv", "01234567890", "ABCDEFGHIJK", "LMNOPQRSTUV"];
const nodeId = "11000000-0000-4000-8000-000000000004";
function input(signal = new AbortController().signal) {
  return { signal, nodeId,
    blueprint: { schemaVersion: 1, id: "11000000-0000-4000-8000-000000000001", version: 2, title: "PRIVATE_BLUEPRINT",
      goals: [{ id: "11000000-0000-4000-8000-000000000002", title: "PRIVATE_GOAL", position: 0,
        stages: [{ id: "11000000-0000-4000-8000-000000000003", title: "基础", position: 0,
          nodes: [{ id: nodeId, title: "练习曝光组合", description: "快门 光圈", type: "learn", position: 0, dependencyIds: [], resources: [] }] }] }] },
    preferences: { regionCode: "US", language: "zh-Hans", allowLanguageFallback: true, maxDurationSeconds: 1200, publishedAfter: null },
  };
}
function metadata(id: string) {
  return { id, snippet: { title: "摄影课堂", description: "曝光基础", channelId: "channel-id", channelTitle: "摄影教学", publishedAt: "2018-01-01T00:00:00Z", liveBroadcastContent: "none", defaultAudioLanguage: "en" },
    contentDetails: { duration: "PT5M", caption: "false", regionRestriction: { blocked: id === ids[0] ? ["US"] : [] } },
    status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false },
    statistics: { viewCount: "9007199254740993", favoriteCount: "999" } };
}
const captions = { lang: "en", availableLangs: ["en"], content: [{ text: "比较快门和光圈。", offset: 1500, duration: 2500, lang: "en" }] };
function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  // Two HTTP writes exercise streamed UTF-8 JSON, not a mocked ResourceProvider.
  const bytes = Buffer.from(JSON.stringify(body)), middle = Math.floor(bytes.length / 2);
  response.write(bytes.subarray(0, middle)); response.end(bytes.subarray(middle));
}
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, url: URL) => void) {
  const calls: URL[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1"); calls.push(url); handler(request, response, url);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected local HTTP fixture port");
  const origins: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input)); origins.push(url.origin);
    if (!["https://www.googleapis.com", "https://api.supadata.ai"].includes(url.origin)) throw new Error("Unexpected provider origin");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  const provider = createResourceProvider({ youtubeApiKey: "fixture-youtube-key", supadataApiKey: "fixture-native-key", fetch: fetcher });
  return { calls, origins, provider, discovery: createResourceDiscovery({ provider, now: () => new Date("2026-09-10T00:00:00Z") }),
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

test("real adapters discover source-bound metadata, native fallback, pending jobs and missing captions through local HTTP", async () => {
  const headers: (string | string[] | undefined)[] = [];
  const external = await fixture((request, response, url) => {
    if (url.pathname.endsWith("/search")) return json(response, { items: [...ids, ids[1]].map(videoId => ({ id: { kind: "youtube#video", videoId } })) });
    if (url.pathname.endsWith("/videos")) return json(response, { items: [metadata("unasked00000"), ...ids.toReversed().map(metadata)] });
    headers.push(request.headers["x-api-key"]);
    if (url.pathname === "/v1/transcript/job-fixture") return json(response, { status: "completed", ...captions });
    const id = new URL(url.searchParams.get("url") ?? "https://invalid.example").searchParams.get("v");
    if (id === ids[1]) return json(response, captions);
    if (id === ids[2]) return json(response, { jobId: "job-fixture" }, 202);
    return json(response, { error: "PRIVATE_PROVIDER_ERROR" }, 404);
  });
  try {
    const request = input(), before = structuredClone(request.blueprint);
    const result = await external.discovery.run(request);
    expect(result.status).toBe("discovered");
    if (result.status !== "discovered") throw new Error("Expected resource discovery");
    expect(result.source).toEqual({ blueprintId: request.blueprint.id, blueprintVersion: 2, nodeId, checkedAt: "2026-09-10T00:00:00.000Z" });
    expect(result.candidates.map(candidate => [candidate.video.videoId, candidate.transcript.status, candidate.eligibleForMatching]))
      .toEqual([[ids[1], "ready", true], [ids[2], "pending", false], [ids[3], "not_found", false]]);
    expect(result.candidates[0]).toMatchObject({ languageFallback: true, matching: "not_evaluated", video: { captionAvailable: false, embeddable: false,
      statistics: { viewCount: "9007199254740993", likeCount: null, commentCount: null } }, transcript: { language: "en", segments: captions.content } });
    expect(result.rejected).toEqual([{ videoId: ids[0], reason: "region_restricted" }]);
    expect(result.uninspectedVideoIds).toEqual([ids[4]]);
    expect(external.calls.map(call => call.pathname)).toEqual(["/youtube/v3/search", "/youtube/v3/videos", "/v1/transcript", "/v1/transcript", "/v1/transcript"]);
    expect(external.calls[0].searchParams.get("q")).toBe("练习曝光组合 快门 光圈");
    expect(external.calls[1].searchParams.get("id")).toBe(ids.join(","));
    expect(external.calls.slice(2).map(call => [call.searchParams.get("mode"), call.searchParams.get("text"), call.searchParams.get("lang")]))
      .toEqual([["native", "false", "zh-Hans"], ["native", "false", "zh-Hans"], ["native", "false", "zh-Hans"]]);
    expect(headers).toEqual(["fixture-native-key", "fixture-native-key", "fixture-native-key"]);
    expect(JSON.stringify(result)).not.toMatch(/fixture-.*key|PRIVATE_|favoriteCount/);
    expect(request.blueprint).toEqual(before);
    // Job retrieval is explicit and does not restart generation or mutate source-bound discovery.
    expect(await external.provider.transcriptJob("job-fixture", request.signal)).toMatchObject({ status: "ready", language: "en", segments: captions.content });
    expect(external.calls).toHaveLength(6);
    expect(external.calls[5].pathname).toBe("/v1/transcript/job-fixture");
    expect(external.origins).toEqual(["https://www.googleapis.com", "https://www.googleapis.com", ...Array(4).fill("https://api.supadata.ai")]);
  } finally { await external.close(); }
});

test("actual HTTP rate limiting stays sanitized and does not fan out into details or captions", async () => {
  const external = await fixture((_request, response) => json(response, { error: "PRIVATE_BODY_AND_KEY" }, 429));
  try {
    expect(await external.discovery.run(input())).toEqual({ status: "rate_limited", requests: { catalogMayHaveRun: true, transcriptVideoIds: [] } });
    expect(external.calls).toHaveLength(1);
  } finally { await external.close(); }
});

test("cancelling a stalled real HTTP transcript returns promptly and never requests the next candidate", async () => {
  let transcriptStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { transcriptStarted = resolve; });
  const external = await fixture((_request, response, url) => {
    if (url.pathname.endsWith("/search")) return json(response, { items: ids.slice(1, 4).map(videoId => ({ id: { kind: "youtube#video", videoId } })) });
    if (url.pathname.endsWith("/videos")) return json(response, { items: ids.slice(1, 4).map(metadata) });
    response.writeHead(200, { "content-type": "application/json" }); response.write('{"content":'); transcriptStarted();
  });
  const controller = new AbortController();
  try {
    const result = external.discovery.run(input(controller.signal));
    await Promise.race([started, result.then(() => { throw new Error("Discovery ended before requesting a transcript"); })]);
    controller.abort("PRIVATE_CANCELLATION_REASON");
    expect(await result).toEqual({ status: "cancelled", requests: { catalogMayHaveRun: true, transcriptVideoIds: [ids[1]] } });
    expect(external.calls).toHaveLength(3);
  } finally { controller.abort(); await external.close(); }
});
