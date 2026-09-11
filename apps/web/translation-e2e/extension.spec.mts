import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { transcriptFixture } from "../transcript-e2e/fixture";

test("real OAuth extension → production HTTP → verified translation Edge restores the same Web-owned result", async ({ request }) => {
  const clientId = process.env.BLUEPRINT_TRANSLATION_TEST_EXTENSION_CLIENT_ID;
  test.skip(!clientId, "Use the local OAuth launcher so the client is registered before the production build.");
  const disabled = process.env.BLUEPRINT_TRANSLATION_ENTRY_TEST_DISABLED === "true";
  const owner = await transcriptFixture();
  let grantCreated = false;
  const sql = (query: string) => execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, stdio: "pipe" });
  const ensure = (error: { code?: string } | null) => { if (error) throw new Error(`Local OAuth test failed: ${error.code ?? "unknown"}`); };
  try {
    const redirectUri = "http://127.0.0.1:54329/extension-translation-http-fixture", verifier = randomUUID() + randomUUID(), state = randomUUID();
    const authorize = new URL(`${owner.local.API_URL}/auth/v1/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: clientId!, redirect_uri: redirectUri, scope: "email", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    const authorized = await fetch(authorize, { redirect: "manual" }); expect([302, 303]).toContain(authorized.status);
    const authorizationId = new URL(authorized.headers.get("location")!).searchParams.get("authorization_id")!;
    expect(authorizationId).toBeTruthy();
    ensure((await owner.client.auth.oauth.getAuthorizationDetails(authorizationId)).error);
    const approved = await owner.client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }); ensure(approved.error);
    grantCreated = true;
    const callback = new URL(approved.data!.redirect_url); expect(callback.searchParams.get("state")).toBe(state);
    const exchanged = await fetch(`${owner.local.API_URL}/auth/v1/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: clientId!, redirect_uri: redirectUri, code_verifier: verifier }) });
    expect(exchanged.status).toBe(200); const tokens = await exchanged.json();
    const extension = createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${tokens.access_token}` } } });
    const claims = await extension.auth.getClaims(tokens.access_token); ensure(claims.error); expect(claims.data!.claims.client_id).toBe(clientId);
    const headers = { Authorization: `Bearer ${tokens.access_token}` }, base = "http://127.0.0.1:3200/api/v1/translations/runs";
    const sourceRunId = await owner.acquire(), command = { accountId: owner.ownerId, ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans", runId: randomUUID() };
    const { runId, ...page } = command;
    const query = new URLSearchParams({ ...page, offset: String(page.offset) });
    await request.post("http://127.0.0.1:3201/fixture/reset");
    const calls = async () => (await request.get("http://127.0.0.1:3201/fixture/calls")).json();
    expect((await request.get(`${base}?${query}`, { headers })).status()).toBe(200);
    expect(await calls()).toEqual([]);
    expect((await request.post(base, { data: command })).status()).toBe(401);
    const webSession = (await owner.client.auth.getSession()).data.session!;
    expect((await request.post(base, { headers: { Authorization: `Bearer ${webSession.access_token}` }, data: command })).status()).toBe(401);
    expect((await request.post(base, { headers, data: { ...command, accountId: randomUUID() } })).status()).toBe(403);
    expect((await request.post("http://127.0.0.1:3200/api/translations/runs", { headers, data: command })).status()).toBe(403);
    const oauthCookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify({ ...tokens,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in, user: webSession.user })).toString("base64url")}`;
    expect((await request.get(`http://127.0.0.1:3200/api/translations/runs?${query}`, { headers: { cookie: oauthCookie } })).status()).toBe(403);
    sql(`insert into private.translation_run_quotas values('${owner.ownerId}',2);`);
    const started = await request.post(base, { headers, data: command });
    expect(started.status()).toBe(disabled ? 503 : 200);
    if (disabled) { expect(await started.json()).toEqual({ ok: false, code: "disabled" }); expect(await calls()).toEqual([]); }
    else {
      expect(await started.json()).toEqual({ ok: true, runId, status: "ready" });
      const read = await request.get(`${base}/${runId}?accountId=${owner.ownerId}`, { headers });
      expect(read.status()).toBe(200); const result = await read.json();
      expect(result.run.result.segments).toEqual([{ segmentIndex: 20, translation: "用自己的照片解释你的选择。" }]);
      expect(result.run).not.toHaveProperty("skill"); expect(result.run).not.toHaveProperty("input_page");
      const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(webSession)).toString("base64url")}`;
      const web = await request.get(`http://127.0.0.1:3200/api/translations/runs/${runId}?accountId=${owner.ownerId}`, { headers: { cookie } });
      expect(web.status()).toBe(200); expect((await web.json()).run.result).toEqual(result.run.result);
      expect((await request.post(base, { headers, data: command })).status()).toBe(200);
      expect((await (await request.get(`${base}?${query}`, { headers })).json()).run.runId).toBe(runId);
      expect(await calls()).toHaveLength(1);
      const edge = await request.post(`${owner.local.API_URL}/functions/v1/translation-worker`, { headers, data: { operation: "claim", runId, leaseId: randomUUID() } });
      expect(edge.status()).toBe(403);
    }
    const queuedId = randomUUID();
    const { accountId: _accountId, ...queued } = { ...command, runId: queuedId, offset: 0 };
    ensure((await extension.rpc("begin_translation_run", { p_request: queued })).error);
    const cancelled = await request.post(`${base}/${queuedId}`, { headers, data: { operation: "cancel", accountId: owner.ownerId } });
    expect(cancelled.status()).toBe(200); expect(await cancelled.json()).toEqual({ ok: true, runId: queuedId, status: "cancelled" });
    const stalled = await new Promise<number | undefined>((resolve, reject) => {
      const upload = httpRequest(base, { method: "POST", headers: { ...headers, "content-type": "application/json" } }, response => {
        response.resume(); response.on("end", () => { upload.destroy(); resolve(response.statusCode); }); response.on("error", reject);
      });
      upload.on("error", reject); upload.setTimeout(15000, () => { upload.destroy(); reject(new Error("Upload deadline missing")); }); upload.write("{");
    });
    expect(stalled).toBe(408); expect(await calls()).toHaveLength(disabled ? 0 : 1);
  } finally {
    try { if (grantCreated) ensure((await owner.client.auth.oauth.revokeGrant({ clientId: clientId! })).error); }
    finally { await owner.cleanup(); }
  }
});
