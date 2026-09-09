import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Test tooling only. Capture credentials in memory, never print CLI status or
// use linked-project credentials. Callers must not serialize this object.
export function localSupabaseTestConfig() {
  const config = JSON.parse(execFileSync(process.env.BLUEPRINT_SUPABASE_BIN ?? "supabase", ["status", "-o", "json"], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }));
  assert.equal(config.API_URL, "http://127.0.0.1:54321", "Only the local Supabase test stack is allowed");
  return config;
}
