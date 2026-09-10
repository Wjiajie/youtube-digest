// Test-process preload only. No production import, proxy setting or real provider request.
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" || process.env.DEEPSEEK_API_KEY !== "resource-fixture-model-key"
  || process.env.YOUTUBE_API_KEY !== "resource-fixture-youtube-key" || process.env.SUPADATA_API_KEY !== "resource-fixture-native-key") {
  throw new Error("Resource fixture requires isolated local configuration");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["www.googleapis.com", "api.supadata.ai", "api.deepseek.com"].includes(url.hostname)) return originalFetch(input, init);
  if (url.protocol !== "https:") throw new Error("Unexpected provider protocol");
  return originalFetch(`http://127.0.0.1:3166${url.pathname}${url.search}`, init);
};
