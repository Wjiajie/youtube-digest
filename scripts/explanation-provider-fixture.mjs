// Test-process preload only; never imported by production application code.
const disabled = process.env.BLUEPRINT_EXPLANATION_ENABLED === "false";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321"
  || process.env.DEEPSEEK_API_KEY !== (disabled ? "" : "explanation-fixture-model-key")) {
  throw new Error("Explanation fixture requires an isolated local configuration");
}
const originalFetch = globalThis.fetch;
// Observe production-process failures without catching, suppressing or logging
// exception objects. Only a count crosses this test-only loopback boundary.
process.on("uncaughtExceptionMonitor", () => {
  void originalFetch("http://127.0.0.1:3201/fixture/uncaught", { method: "POST", signal: AbortSignal.timeout(2000) }).catch(() => undefined);
});
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "http://127.0.0.1:54321" && ["/auth/v1/user", "/auth/v1/.well-known/jwks.json"].includes(url.pathname))
    return originalFetch(`http://127.0.0.1:3201/fixture/auth/${url.pathname.slice("/auth/v1/".length)}`, init);
  if (url.hostname !== "api.deepseek.com") return originalFetch(input, init);
  if (disabled) throw new Error("Disabled explanation must not contact a model");
  if (url.href !== "https://api.deepseek.com/chat/completions"
    || new Headers(init?.headers).get("authorization") !== "Bearer explanation-fixture-model-key") throw new Error("Unexpected explanation model request");
  return originalFetch("http://127.0.0.1:3201/chat/completions", init);
};
