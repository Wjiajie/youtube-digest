// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=abcdefghijk"}
import { afterEach, beforeEach, expect, test, vi } from "vitest";
type Listener = (message: unknown, sender: { id?: string; tab?: unknown; url?: string }) => unknown;
const runtime = vi.hoisted(() => ({ listener: null as Listener | null }));
vi.mock("wxt/browser", () => ({ browser: { runtime: { id: "blueprint-test", onMessage: { addListener: (listener: Listener) => { runtime.listener = listener; } } } } }));
let player: HTMLDivElement, video: HTMLVideoElement;
const playerApi = { getVideoData: vi.fn(), getCurrentTime: vi.fn(), getDuration: vi.fn() };
const listeners: [string, EventListenerOrEventListenerObject][] = [];
const definitions: { main: () => void; world: string; allFrames: boolean }[] = [];
beforeEach(async () => {
  vi.resetModules(); runtime.listener = null; definitions.length = 0;
  history.replaceState(null, "", "/watch?v=abcdefghijk");
  player = document.createElement("div"); player.id = "movie_player"; Object.assign(player, playerApi);
  video = document.createElement("video"); video.className = "html5-main-video"; player.append(video); document.body.append(player);
  Object.defineProperties(video, { readyState: { configurable: true, value: 4 }, currentSrc: { configurable: true, value: "https://media.example.test/clip" }, duration: { configurable: true, value: 100 }, currentTime: { configurable: true, value: 75.8 } });
  playerApi.getVideoData.mockReset().mockReturnValue({ video_id: "abcdefghijk", isLive: false });
  playerApi.getCurrentTime.mockReset().mockReturnValue(75.8); playerApi.getDuration.mockReset().mockReturnValue(100);
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => { listeners.push([type, listener]); add(type, listener, options); });
  vi.stubGlobal("defineContentScript", (definition: { main: () => void; world: string; allFrames: boolean }) => { definitions.push(definition); definition.main(); return definition; });
  await import("../entrypoints/player-main.content"); await import("../entrypoints/player.content");
});
afterEach(() => { for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function read() { return runtime.listener!({ type: "BLUEPRINT_READ_PLAYER_POSITION", videoId: "abcdefghijk" }, { id: "blueprint-test" }); }
test("the actual isolated and MAIN entrypoints read the matching native player and floor fractional seconds", async () => {
  expect(await read()).toEqual({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 75 } });
  Object.defineProperty(video, "currentTime", { configurable: true, value: 0 }); playerApi.getCurrentTime.mockReturnValue(0);
  expect(await read()).toEqual({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 0 } });
});
test("live content is never mistaken for ordinary video even when its live window has a finite duration", async () => {
  playerApi.getVideoData.mockReturnValue({ video_id: "abcdefghijk", isLive: false, isLiveContent: true });
  expect(await read()).toEqual({ ok: false, code: "unavailable" });
});
test("content does not read the page for unrelated messages, content senders or extra payload data", async () => {
  expect(await runtime.listener!({ type: "OTHER" }, { id: "blueprint-test" })).toBeUndefined();
  for (const sender of [{ id: "another-extension" }, { id: "blueprint-test", tab: { id: 7 } }])
    expect(await runtime.listener!({ type: "BLUEPRINT_READ_PLAYER_POSITION", videoId: "abcdefghijk" }, sender)).toEqual({ ok: false, code: "unavailable" });
  expect(await runtime.listener!({ type: "BLUEPRINT_READ_PLAYER_POSITION", videoId: "abcdefghijk", text: "private" }, { id: "blueprint-test" })).toEqual({ ok: false, code: "unavailable" });
  expect(playerApi.getVideoData).not.toHaveBeenCalled();
});
test.each(["ad-showing", "ad-interrupting", "ytp-live"])("native player state %s is rejected without asking the page API", async className => {
  player.classList.add(className); expect(await read()).toEqual({ ok: false, code: "unavailable" }); expect(playerApi.getVideoData).not.toHaveBeenCalled();
});
test("generic live-badge color styling does not block a verified ordinary recording", async () => {
  player.classList.add("ytp-livebadge-color"); expect(await read()).toEqual({ ok: true, value: { videoId: "abcdefghijk", positionSeconds: 75 } });
});
test.each([
  ["readyState", 1], ["seeking", true], ["currentSrc", ""], ["duration", Infinity], ["duration", 0],
  ["currentTime", NaN], ["currentTime", -1], ["currentTime", 101], ["error", { code: 1 }],
])("native media uncertainty %s=%s produces no position", async (key, value) => {
  Object.defineProperty(video, key as string, { configurable: true, value }); expect(await read()).toEqual({ ok: false, code: "unavailable" });
});
test("missing or multiple main media players are not guessed", async () => {
  video.remove(); expect(await read()).toEqual({ ok: false, code: "unavailable" });
  player.append(video, video.cloneNode()); expect(await read()).toEqual({ ok: false, code: "unavailable" });
  video.nextSibling!.remove(); document.body.append(player.cloneNode(true)); expect(await read()).toEqual({ ok: false, code: "unavailable" });
});
test("SPA mismatches and native/API disagreement fail closed", async () => {
  playerApi.getVideoData.mockReturnValue({ video_id: "12345678901", isLive: false }); expect(await read()).toEqual({ ok: false, code: "unavailable" });
  playerApi.getVideoData.mockReturnValue({ video_id: "abcdefghijk", isLive: false });
  playerApi.getCurrentTime.mockReturnValue(70); expect(await read()).toEqual({ ok: false, code: "unavailable" });
  playerApi.getCurrentTime.mockReturnValue(75.8); playerApi.getDuration.mockReturnValue(150); expect(await read()).toEqual({ ok: false, code: "unavailable" });
  playerApi.getDuration.mockImplementation(() => { history.replaceState(null, "", "/watch?v=12345678901"); return 100; });
  expect(await read()).toEqual({ ok: false, code: "unavailable" });
});
test("identity changing inside page-owned read methods cannot produce a receipt", async () => {
  playerApi.getVideoData.mockReturnValueOnce({ video_id: "abcdefghijk", isLive: false }).mockReturnValueOnce({ video_id: "12345678901", isLive: false });
  expect(await read()).toEqual({ ok: false, code: "unavailable" });
});
test("only a nonce crosses into the page and page-controlled replies remain strictly bounded and native-checked", async () => {
  const requestListener = listeners.find(([type]) => type === "blueprint:player-position-request:v1")![1];
  window.removeEventListener("blueprint:player-position-request:v1", requestListener);
  const requests: unknown[] = [];
  const page = (event: Event) => {
    const request = JSON.parse((event as CustomEvent).detail); requests.push(request);
    window.dispatchEvent(new CustomEvent("blueprint:player-position-response:v1", { detail: JSON.stringify({ nonce: request.nonce, ok: true,
      videoId: "abcdefghijk", currentTime: 1, duration: 100, isLive: false }) }));
  };
  window.addEventListener("blueprint:player-position-request:v1", page);
  expect(await read()).toEqual({ ok: false, code: "unavailable" });
  expect(requests).toHaveLength(1); expect(Object.keys(requests[0] as object)).toEqual(["nonce"]);
});
test("missing MAIN bridge times out without retrying or keeping the response listener", async () => {
  const requestListener = listeners.find(([type]) => type === "blueprint:player-position-request:v1")![1];
  window.removeEventListener("blueprint:player-position-request:v1", requestListener);
  vi.useFakeTimers(); const remove = vi.spyOn(window, "removeEventListener"); const pending = read();
  await vi.advanceTimersByTimeAsync(900);
  expect(await pending).toEqual({ ok: false, code: "unavailable" });
  expect(remove).toHaveBeenCalledWith("blueprint:player-position-response:v1", expect.any(Function));
  expect(playerApi.getVideoData).not.toHaveBeenCalled();
});
test("the MAIN page event accepts only a nonce and never arbitrary methods, URLs or private fields", () => {
  for (const request of [{ nonce: crypto.randomUUID(), method: "playVideo" }, { nonce: crypto.randomUUID(), url: "https://evil.test" }, { nonce: crypto.randomUUID(), text: "private note" }, { nonce: "invalid" }])
    window.dispatchEvent(new CustomEvent("blueprint:player-position-request:v1", { detail: JSON.stringify(request) }));
  window.dispatchEvent(new CustomEvent("blueprint:player-position-request:v1", { detail: { nonce: crypto.randomUUID() } }));
  expect(playerApi.getVideoData).not.toHaveBeenCalled();
  expect(playerApi.getCurrentTime).not.toHaveBeenCalled();
});
test("both static entrypoints are top-frame only and refuse installation inside a child frame", () => {
  expect(definitions.map(({ world, allFrames }) => ({ world, allFrames }))).toEqual([{ world: "MAIN", allFrames: false }, { world: "ISOLATED", allFrames: false }]);
  const iframe = document.createElement("iframe"); document.body.append(iframe);
  runtime.listener = null; const count = listeners.length;
  vi.stubGlobal("window", iframe.contentWindow);
  try { for (const definition of definitions) definition.main(); }
  finally { vi.unstubAllGlobals(); }
  expect(runtime.listener).toBeNull(); expect(listeners).toHaveLength(count);
});
