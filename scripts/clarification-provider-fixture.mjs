// Isolated test-process preload. Never imported by production application code.
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" || process.env.DEEPSEEK_API_KEY !== "clarification-fixture-key") {
  throw new Error("Clarification fixture requires the isolated local configuration");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname !== "api.deepseek.com") return originalFetch(input, init);
  if (url.href !== "https://api.deepseek.com/chat/completions" || new Headers(init?.headers).get("authorization") !== "Bearer clarification-fixture-key") {
    throw new Error("Unrecognized clarification provider request");
  }
  const request = JSON.parse(init.body);
  if (request.model !== "deepseek-flash" || request.stream) throw new Error("Unexpected clarification model request");
  const prompt = request.messages.find(message => message.role === "user");
  const document = JSON.parse(prompt.content);
  const answer = "我想制作摄影作品。我会用相机。每周180分钟。成功依据是六张照片与取舍记录。";
  if (document.message !== answer || document.currentQuestion !== "你希望实现什么目标？" || document.history.length !== 0
    || !request.messages.some(message => message.role === "system" && message.content.includes("# Clarify a Goal Brief"))) {
    throw new Error("Unexpected captured clarification input");
  }
  await new Promise((resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 1500);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal?.addEventListener("abort", abort, { once: true });
  });
  const suggestion = {
    reflection: "**你想让摄影成为可回顾的作品。**\n\n你已经说明了起点、投入时间，以及判断进步的依据。请核对右侧摘要是否准确。\n\n[外部内容不应成为可点击链接](https://clarification-unsafe.example.test/link) ![外部图片不应加载](https://clarification-unsafe.example.test/image.png)",
    changes: [
      { field: "outcome", value: "制作摄影作品", quote: "我想制作摄影作品" },
      { field: "startingPoint", value: "会用相机", quote: "我会用相机" },
      { field: "weeklyMinutes", value: 180, quote: "每周180分钟" },
      { field: "successCriteria", value: "六张照片与取舍记录", quote: "成功依据是六张照片与取舍记录" },
    ],
    question: null, concerns: [], pause: null,
  };
  return Response.json({
    id: "clarification-offline-fixture", object: "chat.completion", created: 1, model: "deepseek-flash",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(suggestion) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
  });
};
