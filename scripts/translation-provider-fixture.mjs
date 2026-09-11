// Test-process preload only; never imported by production application code.
const disabled = process.env.BLUEPRINT_TRANSLATION_ENABLED === "false";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321"
  || process.env.DEEPSEEK_API_KEY !== (disabled ? "" : "translation-fixture-model-key")) {
  throw new Error("Translation fixture requires an isolated local configuration");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.deepseek.com") return originalFetch(input, init);
  if (disabled) throw new Error("Disabled translation must not contact a model");
  if (url.href !== "https://api.deepseek.com/chat/completions"
    || new Headers(init?.headers).get("authorization") !== "Bearer translation-fixture-model-key") throw new Error("Unexpected translation model request");
  return originalFetch("http://127.0.0.1:3201/chat/completions", init);
};
