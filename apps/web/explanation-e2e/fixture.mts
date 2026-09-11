import { createServerClient } from "@supabase/ssr";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { transcriptFixture } from "../transcript-e2e/fixture";

export const origin = "http://127.0.0.1:3200", provider = "http://127.0.0.1:3201";
export const disabled = process.env.BLUEPRINT_EXPLANATION_ENTRY_TEST_DISABLED === "true";
export const selection = { start: { segmentIndex: 20, charOffset: 5 }, end: { segmentIndex: 20, charOffset: 17 } };
export const answer = { kind: "explanation", meaning: "用自己的照片表达和解释选择。", reasoning: "原文要求用自己的照片解释，不是单纯观看示范。",
  background: null, checkQuestion: "你能用哪张自己的照片说明选择？", limitations: ["当前片段没有给出具体拍摄参数。"], evidence: [{ segmentIndex: 20, quote: "自己的照片" }] };
export function ensure(error: { code?: string } | null) { if (error) throw new Error(`Local explanation fixture failed: ${error.code ?? "unknown"}`); }
export async function explanationAccount() {
  const owner = await transcriptFixture();
  const grants = new Set<string>();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) {
      const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry;
    } },
  } });
  async function cleanup() {
    try {
      const revocations = await Promise.allSettled([...grants].map(async clientId => ensure((await owner.client.auth.oauth.revokeGrant({ clientId })).error)));
      if (revocations.some(result => result.status === "rejected")) throw new Error("Local explanation OAuth grant cleanup failed");
    }
    finally { try { await client.auth.signOut(); } finally { await owner.cleanup(); } }
  }
  async function authorize(clientId: string) {
    const redirectUri = "http://127.0.0.1:54329/extension-explanation-http-fixture", verifier = randomUUID() + randomUUID(), state = randomUUID();
    const authorizeUrl = new URL(`${owner.local.API_URL}/auth/v1/oauth/authorize`);
    authorizeUrl.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "email", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    const authorized = await fetch(authorizeUrl, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    if (![302, 303].includes(authorized.status)) throw new Error("Local OAuth authorization failed");
    const authorizationId = new URL(authorized.headers.get("location")!).searchParams.get("authorization_id")!;
    ensure((await owner.client.auth.oauth.getAuthorizationDetails(authorizationId)).error);
    const approved = await owner.client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }); ensure(approved.error);
    grants.add(clientId);
    const callback = new URL(approved.data!.redirect_url);
    if (callback.searchParams.get("state") !== state) throw new Error("Local OAuth state mismatch");
    const exchanged = await fetch(`${owner.local.API_URL}/auth/v1/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }), signal: AbortSignal.timeout(10000) });
    if (exchanged.status !== 200) throw new Error("Local OAuth code exchange failed");
    const tokens = await exchanged.json();
    const claims = await owner.client.auth.getClaims(tokens.access_token); ensure(claims.error);
    if (claims.data?.claims.client_id !== clientId || claims.data.claims.sub !== owner.ownerId) throw new Error("Local OAuth identity mismatch");
    const session = (await owner.client.auth.getSession()).data.session!;
    return { headers: { Authorization: `Bearer ${tokens.access_token}` },
      cookie: `sb-127-auth-token=base64-${Buffer.from(JSON.stringify({ ...tokens, expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in, user: session.user })).toString("base64url")}` };
  }
  try {
    ensure((await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error);
    execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: `insert into private.explanation_run_quotas(owner_id,remaining) values('${owner.ownerId}',2);`, stdio: ["pipe", "pipe", "pipe"], timeout: 15000,
    });
    return { ...owner, cleanup, authorize, cookies, headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "), origin },
      commandFor: (sourceRunId: string, runId: string) => ({ accountId: owner.ownerId, runId, ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans", selection, question: "怎样练习？" }) };
  } catch (error) { await cleanup(); throw error; }
}
