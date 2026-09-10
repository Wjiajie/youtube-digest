// This page-owned API is an unsupported YouTube integration, never trusted data.
// Only these fixed read methods are called; requests carry a nonce, no private data.
type YouTubePlayer = HTMLElement & {
  getVideoData(): { video_id?: unknown; isLive?: unknown; isLiveContent?: unknown };
  getCurrentTime(): number;
  getDuration(): number;
};
export default defineContentScript({ matches: ["https://www.youtube.com/*"], world: "MAIN", allFrames: false, runAt: "document_start", main() {
  if (window.top !== window) return;
  window.addEventListener("blueprint:player-position-request:v1", event => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string" || event.detail.length > 100) return;
    let nonce: string;
    try {
      const request = JSON.parse(event.detail);
      if (!request || Object.keys(request).length !== 1 || typeof request.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(request.nonce)) return;
      nonce = request.nonce;
    } catch { return; }
    let response: unknown = { nonce, ok: false };
    try {
      const beforeUrl = location.href;
      const players = document.querySelectorAll<YouTubePlayer>("#movie_player");
      if (players.length !== 1) throw new Error("No unique player");
      const player = players[0]!;
      const before = player.getVideoData();
      const videoId = before.video_id, isLive = before.isLive === true || before.isLiveContent === true;
      const currentTime = player.getCurrentTime(), duration = player.getDuration();
      const after = player.getVideoData();
      if (location.href !== beforeUrl || typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId) || after.video_id !== videoId || (after.isLive === true || after.isLiveContent === true) !== isLive
        || !Number.isFinite(currentTime) || !Number.isFinite(duration) || currentTime < 0 || duration <= 0 || currentTime > duration) throw new Error("Unstable player");
      response = { nonce, ok: true, videoId, currentTime, duration, isLive };
    } catch { /* A missing or changed page API has no usable position. */ }
    window.dispatchEvent(new CustomEvent("blueprint:player-position-response:v1", { detail: JSON.stringify(response) }));
  });
} });
