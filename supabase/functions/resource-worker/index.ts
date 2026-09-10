import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { createResourceWorker } from "./handler.ts";

Deno.serve(createResourceWorker({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  workerSecret: Deno.env.get("BLUEPRINT_RESOURCE_WORKER_SECRET") ?? "",
}, (url, key, options) => {
  const client = createClient(url, key, options);
  return { auth: client.auth, rpc: (name, args) => client.rpc(name, args) };
}, ["BLUEPRINT_PLANNING_WORKER_SECRET", "BLUEPRINT_CLARIFICATION_WORKER_SECRET", "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "SUPADATA_API_KEY"]
  .map(name => Deno.env.get(name) ?? "")));
