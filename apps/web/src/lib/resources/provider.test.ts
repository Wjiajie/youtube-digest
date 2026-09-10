import { afterEach, expect, test, vi } from "vitest";
import { createResourceProvider } from "./provider";

const first = "abcdefghijk", second = "lmnopqrstuv";
const signal = () => new AbortController().signal;
const request = { query: "camera exposure", regionCode: "US", relevanceLanguage: "en" };
function video(id = first) {
  return { id, snippet: { title: "Exposure", description: "Practice exposure", channelId: "channel", channelTitle: "Camera", publishedAt: "2025-01-02T00:00:00Z", liveBroadcastContent: "none", defaultAudioLanguage: "en" },
    contentDetails: { duration: "PT1H2M3S", caption: "true", regionRestriction: { allowed: ["US", "GB"] } },
    status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false },
    statistics: { viewCount: "900719925474099312345", likeCount: "0009", commentCount: 12, favoriteCount: "999" } };
}
function fixture(responses: Response[]) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    const response = responses.shift(); if (!response) throw new Error("Unexpected external request"); return response;
  };
  return { provider: createResourceProvider({ youtubeApiKey: "youtube-fixture", supadataApiKey: "supadata-fixture", fetch: fetcher }), calls };
}
afterEach(() => vi.useRealTimers());
const transcript = { content: [{ text: "相机曝光", offset: 100, duration: 1500, lang: "zh-TW" }], lang: "zh-TW", availableLangs: ["zh-TW", "en"] };

test("unreported optional platform counts do not discard an otherwise valid video", async () => {
  const { provider } = fixture([
    Response.json({ items: [{ id: { kind: "youtube#video", videoId: first } }] }),
    Response.json({ items: [{ ...video(), statistics: { viewCount: "9007199254740993" } }] }),
  ]);
  const result = await provider.search(request, signal());
  expect(result).toMatchObject({ status: "ready", videos: [{ videoId: first, statistics: { viewCount: "9007199254740993", likeCount: null, commentCount: null } }] });
});

test("native-only captions retain actual fallback language and an explicit job read consumes the official top-level result without starting again", async () => {
  const { provider, calls } = fixture([Response.json(transcript), Response.json({ jobId: "job-123" }, { status: 202 }),
    Response.json({ status: "queued" }), Response.json({ status: "active" }), Response.json({ status: "completed", ...transcript })]);
  const expected = { status: "ready", language: "zh-TW", availableLanguages: ["zh-TW", "en"], segments: transcript.content };
  expect(await provider.nativeTranscript(first, "en", signal())).toEqual(expected);
  expect(await provider.nativeTranscript(second, "en", signal())).toEqual({ status: "pending", jobId: "job-123" });
  expect(calls).toHaveLength(2);
  for (const status of ["queued", "active"]) {
    expect(await provider.transcriptJob("job-123", signal()), status).toEqual({ status: "pending", jobId: "job-123" });
  }
  expect(await provider.transcriptJob("job-123", signal())).toEqual(expected);
  expect(calls).toHaveLength(5);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.supadata.ai/v1/transcript");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ url: `https://www.youtube.com/watch?v=${first}`, lang: "en", mode: "native", text: "false" });
  expect(calls.slice(2).map(call => call.url.href)).toEqual(Array(3).fill("https://api.supadata.ai/v1/transcript/job-123"));
  expect(calls.every(call => new Headers(call.init?.headers).get("x-api-key") === "supadata-fixture" && call.init?.redirect === "error")).toBe(true);
});

test("fixed YouTube search resolves only deduplicated returned IDs, retains search order and preserves raw platform counts", async () => {
  const { provider, calls } = fixture([
    Response.json({ items: [{ id: { kind: "youtube#video", videoId: first } }, { id: { kind: "youtube#video", videoId: second } }, { id: { kind: "youtube#video", videoId: first } }, { id: { kind: "youtube#channel", videoId: "01234567890" } }, { id: { videoId: "bad" } }] }),
    Response.json({ items: [video(second), video("01234567890"), video(first), video(first)] }),
  ]);
  const result = await provider.search(request, signal());
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected catalog");
  expect(result.videos.map(item => item.videoId)).toEqual([first, second]);
  expect(result.videos[0]).toEqual({ videoId: first, title: "Exposure", description: "Practice exposure", channelId: "channel", channelTitle: "Camera", publishedAt: "2025-01-02T00:00:00Z", durationSeconds: 3723,
    audioLanguage: "en", defaultLanguage: null, captionAvailable: true, privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: false, allowedRegions: ["US", "GB"], blockedRegions: [], ageRestricted: false,
    statistics: { viewCount: "900719925474099312345", likeCount: "0009", commentCount: null } });
  expect(calls).toHaveLength(2);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ part: "snippet", type: "video", order: "relevance", safeSearch: "strict", maxResults: "10", q: "camera exposure", relevanceLanguage: "en", regionCode: "US", key: "youtube-fixture" });
  expect(calls[1].url.origin + calls[1].url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
  expect(calls[1].url.searchParams.get("part")).toBe("snippet,contentDetails,status,statistics");
  expect(calls[1].url.searchParams.get("id")).toBe(`${first},${second}`);
  expect(calls.every(call => call.init?.redirect === "error")).toBe(true);
});

test("cancellation returns promptly even when external fetch ignores the signal, and an already cancelled call sends nothing", async () => {
  vi.useFakeTimers();
  const calls: RequestInit[] = [];
  const fetcher: typeof fetch = (_input, init) => { calls.push(init!); return new Promise(() => {}); };
  const provider = createResourceProvider({ youtubeApiKey: "private-key", fetch: fetcher });
  const controller = new AbortController();
  let result: unknown;
  void provider.search(request, controller.signal).then(value => { result = value; });
  controller.abort("private cancellation reason");
  await vi.advanceTimersByTimeAsync(0);
  expect(result).toEqual({ status: "cancelled" });
  expect(calls[0].signal?.aborted).toBe(true);
  expect(await provider.search(request, controller.signal)).toEqual({ status: "cancelled" });
  expect(calls).toHaveLength(1);
});

test.each(["fetch", "body"])("the 10 second deadline includes a stalled %s without leaking provider errors", async phase => {
  vi.useFakeTimers();
  const fetcher: typeof fetch = async () => phase === "fetch" ? new Promise(() => {}) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"content":')); } }));
  const provider = createResourceProvider({ supadataApiKey: "private-key", fetch: fetcher });
  let result: unknown;
  void provider.nativeTranscript(first, "en", signal()).then(value => { result = value; });
  await vi.advanceTimersByTimeAsync(9999); expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1); expect(result).toEqual({ status: "timed_out" });
});

test.each(["declared", "streamed"])("a %s response over 1 MiB is refused and its stream is cancelled", async mode => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(JSON.stringify({ ...transcript, content: [{ text: "汉".repeat(720000), offset: 0, duration: 1 }] }));
  let offset = 0;
  const body = new ReadableStream({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset += 65536)); }, cancel() { cancelled = true; } });
  const { provider } = fixture([new Response(body, { headers: mode === "declared" ? { "content-length": String(bytes.length) } : {} })]);
  const result = await provider.nativeTranscript(first, "en", signal());
  expect(result.status).toBe("unavailable");
  expect(Object.keys(result)).toEqual(["status"]);
  expect(cancelled).toBe(true);
});

test.each([[404, "not_found"], [429, "rate_limited"], [408, "timed_out"], [504, "timed_out"], [401, "unavailable"], [503, "unavailable"], [302, "unavailable"]])("HTTP %s yields only sanitized %s without retry or raw private errors", async (code, status) => {
  const { provider, calls } = fixture([Response.json({ error: "private-key + raw provider message" }, { status: Number(code) })]);
  expect(await provider.nativeTranscript(first, "en", signal())).toEqual({ status });
  expect(calls).toHaveLength(1);
});

test("missing keys, invalid language/IDs and unsafe job paths stop before the external HTTP seam", async () => {
  let count = 0;
  const fetcher: typeof fetch = async () => { count++; throw new Error("No HTTP expected"); };
  const missing = createResourceProvider({ fetch: fetcher });
  expect(await missing.search(request, signal())).toEqual({ status: "unavailable" });
  expect(await missing.nativeTranscript(first, "en", signal())).toEqual({ status: "unavailable" });
  expect(await missing.transcriptJob("job", signal())).toEqual({ status: "unavailable" });
  const configured = createResourceProvider({ youtubeApiKey: "key", supadataApiKey: "key", fetch: fetcher });
  expect(await configured.search({ ...request, regionCode: "us" }, signal())).toEqual({ status: "invalid_input" });
  expect(await configured.nativeTranscript("https://outside.example/", "en", signal())).toEqual({ status: "invalid_input" });
  expect(await configured.nativeTranscript(first, "../../x", signal())).toEqual({ status: "invalid_input" });
  expect(await configured.transcriptJob("..", signal())).toEqual({ status: "invalid_input" });
  expect(await configured.transcriptJob("https://outside.example/", signal())).toEqual({ status: "invalid_input" });
  expect(count).toBe(0);
});

test.each([
  { ...transcript, lang: undefined }, { ...transcript, lang: "" }, { ...transcript, content: [] },
  { ...transcript, content: "unstructured text" }, { ...transcript, availableLangs: undefined },
  { ...transcript, content: [{ text: " ", offset: 0, duration: 1 }] },
  { ...transcript, content: [{ text: "x", offset: -1, duration: 1 }] },
  { ...transcript, content: [{ text: "x", offset: Number.MAX_SAFE_INTEGER, duration: 10 }] },
  { jobId: "not-a-200-transcript" },
])("malformed native captions cannot become verified evidence (%#)", async body => {
  const { provider, calls } = fixture([Response.json(body)]);
  expect(await provider.nativeTranscript(first, "en", signal())).toEqual({ status: "unavailable" });
  expect(calls).toHaveLength(1);
});

test("JSON overflow and failed job error text are sanitized, and nested result wrappers are not fabricated into the official job shape", async () => {
  const { provider } = fixture([
    new Response('{"lang":"en","availableLangs":["en"],"content":[{"text":"x","offset":1e999,"duration":1}]}'),
    Response.json({ status: "failed", error: { message: "private provider/key details" } }),
    Response.json({ status: "completed", result: transcript }),
  ]);
  expect(await provider.nativeTranscript(first, "en", signal())).toEqual({ status: "unavailable" });
  expect(await provider.transcriptJob("job", signal())).toEqual({ status: "unavailable" });
  expect(await provider.transcriptJob("job", signal())).toEqual({ status: "unavailable" });
});

test("malformed duration and region metadata are omitted rather than guessed; valid no-caption and restricted metadata are preserved for policy", async () => {
  const third = "01234567890";
  const valid = video(third); valid.contentDetails.caption = "false"; valid.contentDetails.regionRestriction.allowed = [];
  const { provider, calls } = fixture([
    Response.json({ items: [first, second, third].map(id => ({ id: { kind: "youtube#video", videoId: id } })) }),
    Response.json({ items: [{ ...video(), contentDetails: { duration: "PT999999999999999999999999999999H", caption: "true" } },
      { ...video(second), contentDetails: { duration: "PT5M", caption: "true", regionRestriction: { allowed: "US" } } }, valid] }),
  ]);
  const result = await provider.search(request, signal());
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected catalog");
  expect(result.videos.map(item => item.videoId)).toEqual([third]);
  expect(result.videos[0].captionAvailable).toBe(false);
  expect(result.videos[0].allowedRegions).toEqual([]);
  expect(calls).toHaveLength(2);
});

test("empty search skips details and an oversized search page never expands the ten-ID request budget", async () => {
  const ids = Array.from({ length: 12 }, (_, index) => String(index).padStart(11, "0"));
  const { provider, calls } = fixture([Response.json({ items: [] }), Response.json({ items: ids.map(id => ({ id: { kind: "youtube#video", videoId: id } })) }), Response.json({ items: [] })]);
  expect(await provider.search(request, signal())).toEqual({ status: "ready", videos: [] });
  expect(calls).toHaveLength(1);
  expect(await provider.search(request, signal())).toEqual({ status: "ready", videos: [] });
  expect(calls).toHaveLength(3);
  expect(calls[2].url.searchParams.get("id")?.split(",")).toEqual(ids.slice(0, 10));
});

test("a late successful search response is cancelled without reading its body or launching details", async () => {
  let finish: (response: Response) => void = () => {};
  let requests = 0, cancelled = false;
  const provider = createResourceProvider({ youtubeApiKey: "key", fetch: () => { requests++; return new Promise(resolve => { finish = resolve; }); } });
  const controller = new AbortController();
  const pending = provider.search(request, controller.signal);
  controller.abort();
  expect(await pending).toEqual({ status: "cancelled" });
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(cancelled).toBe(true); expect(requests).toBe(1);
});

test("external cancellation also wins during a stalled body and thrown transport details are never returned", async () => {
  let started: () => void = () => {};
  const bodyRead = new Promise<void>(resolve => { started = resolve; });
  const controller = new AbortController();
  const { provider } = fixture([new Response(new ReadableStream({ pull() { started(); } }))]);
  const pending = provider.transcriptJob("job", controller.signal);
  await bodyRead; controller.abort("private reason");
  expect(await pending).toEqual({ status: "cancelled" });
  const failed = createResourceProvider({ youtubeApiKey: "secret", fetch: async () => { throw new Error("secret provider request contents"); } });
  expect(await failed.search(request, signal())).toEqual({ status: "unavailable" });
});
