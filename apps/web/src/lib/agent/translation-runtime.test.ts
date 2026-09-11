import { afterEach, expect, it, vi } from "vitest";
import { translationConfiguration } from "./translation-runtime";

afterEach(() => vi.unstubAllEnvs());
function environment() {
  vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "true");
  vi.stubEnv("BLUEPRINT_TRANSLATION_WORKER_SECRET", "translation-only-fixture-worker-credential");
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-model-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
}
it("requires its own explicit execution opt-in and does not need administrator or resource keys", () => {
  environment(); vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "false");
  vi.stubEnv("BLUEPRINT_RESOURCES_ENABLED", "true");
  expect(translationConfiguration()).toBeNull();
  vi.stubEnv("BLUEPRINT_TRANSLATION_ENABLED", "true");
  expect(translationConfiguration()).toEqual({ url: "http://127.0.0.1:54321", publishableKey: "fixture-public-key",
    apiKey: "fixture-model-key", workerKey: "translation-only-fixture-worker-credential" });
});
it.each(["BLUEPRINT_TRANSLATION_WORKER_SECRET", "DEEPSEEK_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])("fails closed without %s", key => {
  environment(); vi.stubEnv(key, ""); expect(translationConfiguration()).toBeNull();
});
it.each(["BLUEPRINT_PLANNING_WORKER_SECRET", "BLUEPRINT_CLARIFICATION_WORKER_SECRET", "BLUEPRINT_RESOURCE_WORKER_SECRET",
  "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "SUPADATA_API_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])("rejects credential reuse with %s", key => {
  environment(); vi.stubEnv(key, "translation-only-fixture-worker-credential"); expect(translationConfiguration()).toBeNull();
});
