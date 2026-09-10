import { createServer } from "node:http";
import startEdge from "./planning-edge-test-setup.mjs";

// Loopback-only response fixtures, never a model evaluation or real provider quota.
export default async function setup() {
  const stopEdge = await startEdge();
  const calls = [];
  const json = (response, value, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  const videoId = "abcdefghijk";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/fixture/calls" && request.method === "GET") return json(response, calls);
    if (url.pathname === "/fixture/reset" && request.method === "POST") { calls.length = 0; return json(response, { ok: true }); }
    calls.push({ path: url.pathname, method: request.method });
    if (url.pathname.startsWith("/youtube/v3/") && url.searchParams.get("key") !== "resource-fixture-youtube-key") return json(response, { error: "wrong fixture key" }, 403);
    if (url.pathname === "/youtube/v3/search") return json(response, { items: [{ id: { kind: "youtube#video", videoId } }] });
    if (url.pathname === "/youtube/v3/videos") return json(response, { items: [{ id: videoId, snippet: { title: "曝光基础", description: "比较快门与光圈",
      channelId: "camera", channelTitle: "摄影", publishedAt: "2018-01-01T00:00:00Z", liveBroadcastContent: "none" }, contentDetails: { duration: "PT5M", caption: "true" },
      status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false } }] });
    if (url.pathname.startsWith("/v1/transcript") && request.headers["x-api-key"] !== "resource-fixture-native-key") return json(response, { error: "wrong fixture key" }, 403);
    if (url.pathname === "/v1/transcript") {
      if (url.searchParams.get("mode") !== "native" || url.searchParams.get("text") !== "false" || url.searchParams.get("url") !== `https://www.youtube.com/watch?v=${videoId}`) return json(response, { error: "wrong native request" }, 422);
      return json(response, { jobId: "resource-entry-native-job" }, 202);
    }
    if (url.pathname === "/v1/transcript/resource-entry-native-job") return json(response, { status: "completed", lang: "en", availableLangs: ["en"],
      content: [{ text: "Compare aperture and shutter speed.", offset: 1500, duration: 2500 }] });
    if (url.pathname === "/chat/completions" && request.headers.authorization === "Bearer resource-fixture-model-key") {
      let body = ""; request.setEncoding("utf8"); request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        try {
          const input = JSON.parse(body);
          if (input.model !== "deepseek-v4-flash" || input.stream) return json(response, { error: "wrong model" }, 422);
          const answer = { summary: "曝光基础可支持当前练习，仍需用户审阅。", assessments: [{ videoId, role: "recommended", relevance: "字幕比较曝光参数。",
            levelFit: "基础内容，完整难度未知。", languageFit: "实际英语字幕，存在回退。", timeFit: "五分钟观看，拍摄另需时间。", freshness: "基础概念不按热度排序。",
            limitations: ["片段不能证明完整教学质量。"], evidence: [{ segmentIndex: 0, quote: "Compare aperture and shutter speed." }] }] };
          return json(response, { id: "resource-entry-fixture", object: "chat.completion", created: 0, model: input.model,
            choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 123, completion_tokens: 234, total_tokens: 357 } });
        } catch { return json(response, { error: "invalid fixture request" }, 422); }
      }); return;
    }
    return json(response, { error: "unrecognized fixture request" }, 404);
  });
  async function stop() {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await stopEdge();
  }
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3166, "127.0.0.1", resolve); });
    const health = await fetch("http://127.0.0.1:54321/functions/v1/resource-worker", { signal: AbortSignal.timeout(2000) });
    if (health.status !== 405) throw new Error("Resource worker did not become ready");
    return stop;
  } catch (error) { await stop(); throw error; }
}
