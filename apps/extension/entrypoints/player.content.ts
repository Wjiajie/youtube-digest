import { browser } from "wxt/browser";
const unavailable = { ok: false, code: "unavailable" } as const;
export default defineContentScript({ matches: ["https://www.youtube.com/*"], world: "ISOLATED", allFrames: false, runAt: "document_start", main() {
  if (window.top !== window) return;
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!object(message) || message.type !== "BLUEPRINT_READ_PLAYER_POSITION") return undefined;
    if (sender.id !== browser.runtime.id || sender.tab !== undefined || Object.keys(message).length !== 2
      || typeof message.videoId !== "string" || !/^[\w-]{11}$/.test(message.videoId)) return unavailable;
    const videoId = message.videoId, beforeUrl = location.href;
    const before = nativePlayer(videoId);
    if (!before) return unavailable;
    return new Promise(resolve => {
      const nonce = crypto.randomUUID();
      const finish = (value: unknown) => { clearTimeout(timer); window.removeEventListener("blueprint:player-position-response:v1", receive); resolve(value); };
      const receive = (event: Event) => {
        if (!(event instanceof CustomEvent) || typeof event.detail !== "string" || event.detail.length > 500) return;
        let result: unknown;
        try { result = JSON.parse(event.detail); } catch { return; }
        if (!object(result) || result.nonce !== nonce) return;
        const after = nativePlayer(videoId);
        if (!after || after.video !== before.video || after.player !== before.player || after.video.currentSrc !== before.src || location.href !== beforeUrl
          || Object.keys(result).length !== 6 || result.ok !== true || result.videoId !== videoId || result.isLive !== false
          || typeof result.currentTime !== "number" || !Number.isFinite(result.currentTime) || result.currentTime < 0
          || typeof result.duration !== "number" || !Number.isFinite(result.duration) || result.duration <= 0 || result.currentTime > result.duration
          || Math.abs(result.currentTime - after.video.currentTime) > 1 || Math.abs(result.duration - after.video.duration) > 1
          || Math.floor(result.currentTime) > 2147483647) return finish(unavailable);
        finish({ ok: true, value: { videoId, positionSeconds: Math.floor(result.currentTime) } });
      };
      const timer = setTimeout(() => finish(unavailable), 900);
      window.addEventListener("blueprint:player-position-response:v1", receive);
      window.dispatchEvent(new CustomEvent("blueprint:player-position-request:v1", { detail: JSON.stringify({ nonce }) }));
    });
  });
} });

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nativePlayer(videoId: string) {
  const url = new URL(location.href);
  if (url.origin !== "https://www.youtube.com" || url.pathname !== "/watch" || url.searchParams.getAll("v").length !== 1 || url.searchParams.get("v") !== videoId) return null;
  const players = document.querySelectorAll<HTMLElement>("#movie_player");
  if (players.length !== 1) return null;
  const player = players[0]!, videos = player.querySelectorAll<HTMLVideoElement>("video.html5-main-video");
  if (videos.length !== 1 || player.matches(".ad-showing,.ad-interrupting,.ytp-live")) return null;
  const video = videos[0]!;
  if (video.readyState < 2 || video.seeking || video.error || !video.currentSrc || !Number.isFinite(video.duration) || video.duration <= 0
    || !Number.isFinite(video.currentTime) || video.currentTime < 0 || video.currentTime > video.duration) return null;
  return { player, video, src: video.currentSrc };
}
