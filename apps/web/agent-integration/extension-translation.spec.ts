import { test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { transcriptFixture } from "../transcript-e2e/fixture";

function sql(query: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: query, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function literal(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function ensure(error: { code?: string } | null, step: string) {
  if (error) throw new Error(`${step} failed: ${error.code ?? "unknown"}`);
}

test("real local OAuth PKCE grant uses only the configured extension translation identity and preserves Web recovery", async () => {
  const owner = await transcriptFixture();
  let clientId: string | undefined;
  let previous: string | null = null, captured = false;
  try {
    previous = JSON.parse(sql("select coalesce((select to_json(value)::text from private.app_config where key='extension_oauth_client_id'),'null')"));
    captured = true;
    const sourceRunId = await owner.acquire();
    const redirectUri = "http://127.0.0.1:54329/extension-translation-fixture";
    const created = await owner.admin.auth.admin.oauth.createClient({ client_name: `Translation fixture ${randomUUID()}`,
      redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: "email" });
    ensure(created.error, "create OAuth fixture");
    clientId = created.data!.client_id;
    const verifier = randomUUID() + randomUUID(), state = randomUUID();
    const authorize = new URL(`${owner.local.API_URL}/auth/v1/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, scope: "email" }).toString();
    const authorized = await fetch(authorize, { redirect: "manual" });
    expect([302, 303]).toContain(authorized.status);
    const authorizationId = new URL(authorized.headers.get("location")!).searchParams.get("authorization_id");
    expect(authorizationId).toBeTruthy();
    const details = await owner.client.auth.oauth.getAuthorizationDetails(authorizationId!);
    ensure(details.error, "read OAuth authorization");
    const approved = await owner.client.auth.oauth.approveAuthorization(authorizationId!, { skipBrowserRedirect: true });
    ensure(approved.error, "approve OAuth authorization");
    const callback = new URL(approved.data!.redirect_url);
    expect(callback.searchParams.get("state")).toBe(state);
    const response = await fetch(`${owner.local.API_URL}/auth/v1/oauth/token`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code",
        code: callback.searchParams.get("code")!, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }) });
    expect(response.status).toBe(200);
    const tokens = await response.json();
    const extension = createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    });
    const verified = await extension.auth.getClaims(tokens.access_token); ensure(verified.error, "verify OAuth JWT");
    expect(verified.data!.claims.client_id).toBe(clientId);
    expect(verified.data!.claims.sub).toBe(owner.ownerId);
    const request = { ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans" }, runId = randomUUID();
    sql(`delete from private.app_config where key='extension_oauth_client_id';`);
    expect((await extension.rpc("find_translation_run", { p_request: request })).error?.code).toBe("42501");
    sql(`insert into private.app_config values('extension_oauth_client_id',${literal(clientId)}); insert into private.translation_run_quotas values('${owner.ownerId}',1);`);
    expect(await extension.rpc("find_translation_run", { p_request: request })).toMatchObject({ data: { run_id: null }, error: null });
    expect(await extension.rpc("begin_translation_run", { p_request: { ...request, runId } })).toMatchObject({ data: { status: "queued" }, error: null });
    expect(await extension.rpc("read_translation_run", { p_run_id: runId })).toMatchObject({ data: { status: "queued" }, error: null });
    expect(await extension.rpc("cancel_translation_run", { p_run_id: runId })).toMatchObject({ data: { status: "cancelled" }, error: null });
    expect(await extension.rpc("find_translation_run", { p_request: request })).toMatchObject({ data: { run_id: runId }, error: null });
    expect(await owner.client.rpc("read_translation_run", { p_run_id: runId })).toMatchObject({ data: { status: "cancelled" }, error: null });
    expect((await extension.rpc("begin_resource_run", { p_request: {} })).error?.code).toBe("42501");
    expect((await extension.rpc("claim_translation_run", { p_owner_id: owner.ownerId, p_run_id: runId, p_lease_id: randomUUID(), p_skill: {}, p_model: "fixture" })).error?.code).toBe("42501");
  } finally {
    try {
      if (clientId) {
        try { ensure((await owner.client.auth.oauth.revokeGrant({ clientId })).error, "revoke OAuth fixture"); }
        finally { ensure((await owner.admin.auth.admin.oauth.deleteClient(clientId)).error, "delete OAuth fixture"); }
      }
    } finally {
      try {
        if (captured) sql(`delete from private.app_config where key='extension_oauth_client_id';${previous === null ? "" : `insert into private.app_config values('extension_oauth_client_id',${literal(previous)});`}`);
      } finally { await owner.cleanup(); }
    }
  }
});
