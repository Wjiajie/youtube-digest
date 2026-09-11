import { createClient } from "@supabase/supabase-js";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { localSupabaseTestConfig } from "./local-supabase-test-config.mjs";

// Local test tooling only: credentials and the prior config never leave memory.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
let child, interrupted, clientId, admin, previous, configChanged = false;
let exitCode = 1;

function sql(query) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    cwd, input: query, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }
function stop(signal) { interrupted = signal; child?.kill(signal); }
const onInterrupt = () => stop("SIGINT"), onTerminate = () => stop("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

try {
  if (args.some(arg => arg === "-c" || arg.startsWith("-c=") || arg === "--config" || arg.startsWith("--config=")))
    throw new Error("The local explanation test configuration cannot be overridden");
  const local = localSupabaseTestConfig();
  const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (containers.split("\n").some(name => name.startsWith("supabase_edge_runtime_")))
    throw new Error("An existing Edge runtime must be left untouched");
  const processes = execFileSync("ps", ["-axo", "comm=,args="], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (processes.split("\n").some(line => /supabase[^\n]*\bfunctions\s+serve\b/.test(line)))
    throw new Error("An existing functions serve process must be left untouched");
  previous = JSON.parse(sql("select coalesce((select to_json(value)::text from private.app_config where key='extension_oauth_client_id'),'null')"));
  if (previous !== null && typeof previous !== "string") throw new Error("Unexpected local extension configuration");
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const created = await admin.auth.admin.oauth.createClient({ client_name: `Explanation HTTP fixture ${randomUUID()}`,
    redirect_uris: ["http://127.0.0.1:54329/extension-explanation-http-fixture"], scope: "email", token_endpoint_auth_method: "none" });
  if (created.error) throw new Error("Temporary OAuth client creation failed");
  clientId = created.data?.client_id;
  if (typeof clientId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId))
    throw new Error("Temporary OAuth client has an invalid identifier");
  if (interrupted) throw new Error("Interrupted before test startup");
  // Mark first so an uncertain database response also attempts exact restoration.
  configChanged = true;
  sql(`insert into private.app_config(key,value) values('extension_oauth_client_id',${literal(clientId)}) on conflict(key) do update set value=excluded.value;`);
  if (interrupted) throw new Error("Interrupted before test startup");
  exitCode = await new Promise((resolve, reject) => {
    child = spawn("npx", ["playwright", "test", "--config", "playwright.explanations.config.ts", ...args], {
      cwd, env: { ...process.env, BLUEPRINT_EXPLANATION_TEST_EXTENSION_CLIENT_ID: clientId }, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)));
  });
} catch {
  // Never print Supabase error objects, command stderr, credentials, or tokens.
  console.error("Local extension explanation launcher failed; no hosted services were used.");
  exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 1;
} finally {
  if (configChanged) {
    try {
      sql(previous === null ? "delete from private.app_config where key='extension_oauth_client_id';"
        : `insert into private.app_config(key,value) values('extension_oauth_client_id',${literal(previous)}) on conflict(key) do update set value=excluded.value;`);
      const restored = JSON.parse(sql("select coalesce((select to_json(value)::text from private.app_config where key='extension_oauth_client_id'),'null')"));
      if (restored !== previous) throw new Error("Local extension configuration did not restore exactly");
    } catch { console.error("Local extension configuration restoration failed; operator follow-up is required."); exitCode ||= 1; }
  }
  if (clientId && admin) {
    try {
      const deleted = await admin.auth.admin.oauth.deleteClient(clientId);
      if (deleted.error) throw new Error("OAuth cleanup failed");
    } catch { console.error("Temporary local OAuth client cleanup failed; operator follow-up is required."); exitCode ||= 1; }
  }
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  process.exitCode = exitCode;
}
