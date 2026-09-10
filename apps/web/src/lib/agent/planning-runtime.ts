import { createDeepSeek, type DeepSeekProviderSettings } from "@ai-sdk/deepseek";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "../env";

/** Only imported by server entry points. No implicit activation from the presence of keys. */
export function planningConfiguration() {
  if (process.env.BLUEPRINT_PLANNING_ENABLED !== "true") return null;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const workerKey = process.env.SUPABASE_PLANNING_SECRET_KEY?.trim();
  if (!apiKey || !workerKey) return null;
  try { return { ...publicSupabaseConfig(), apiKey, workerKey }; } catch { return null; }
}

/** The fetch seam is for SDK integration tests; no runtime proxy URL or model override. */
export function createPlanningModel(apiKey: string, fetch?: DeepSeekProviderSettings["fetch"]) {
  return createDeepSeek({ apiKey, fetch })("deepseek-v4-flash");
}

export function createPlanningWorker(configuration: NonNullable<ReturnType<typeof planningConfiguration>>) {
  return createClient(configuration.url, configuration.workerKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
