// Test-process preload only, never imported by the application or deployed bundle.
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" || process.env.DEEPSEEK_API_KEY !== "planning-fixture-key") {
  throw new Error("Planning fixture requires an isolated local test configuration");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.deepseek.com") return originalFetch(input, init);
  if (url.href !== "https://api.deepseek.com/chat/completions" || new Headers(init?.headers).get("authorization") !== "Bearer planning-fixture-key")
    throw new Error("Unrecognized planning provider request");
  const request = JSON.parse(init.body);
  if (request.model !== "deepseek-v4-flash" || request.stream) throw new Error("Unexpected planning model request");
  await new Promise((resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 3000);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal?.addEventListener("abort", abort, { once: true });
  });
  return Response.json({ id: "planning-offline-fixture", object: "chat.completion", created: 1, model: "deepseek-v4-flash",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ title: "我的摄影练习路径", description: "拍摄与评估",
      assumptions: ["能在周末练习"], stages: [{ title: "拍摄作品", nodes: [{ key: "shoot", type: "practice", title: "完成六张照片",
        description: "围绕同一主题拍摄", estimatedMinutes: 60, completionCriteria: "选出六张并记录取舍", week: 1, dependsOn: [] }] }] }) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } });
};
