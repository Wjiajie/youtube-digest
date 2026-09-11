import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { explanationAccount, origin, provider, disabled, answer, ensure } from "./fixture.mts";

test("registered PKCE OAuth extension shares the exact explanation with Web and rejects other credential kinds", async ({ request }) => {
  const clientId = process.env.BLUEPRINT_EXPLANATION_TEST_EXTENSION_CLIENT_ID;
  if (!clientId) throw new Error("Use the isolated explanation HTTP launcher");
  const owner = await explanationAccount();
  let unrelatedClientId: string | undefined;
  try {
    await request.post(`${provider}/fixture/reset`);
    const oauth = await owner.authorize(clientId), headers = oauth.headers;
    const base = `${origin}/api/v1/explanations/runs`, web = `${origin}/api/explanations/runs`;
    const command = owner.commandFor(await owner.acquire(), randomUUID()), { runId, ...lookup } = command;
    expect(await (await request.post(`${base}/find`, { headers, data: lookup })).json()).toEqual({ ok: true, run: null });
    expect((await request.post(base, { data: command })).status()).toBe(401);
    expect((await request.post(base, { headers: owner.headers, data: command })).status()).toBe(401);
    const webToken = (await owner.client.auth.getSession()).data.session!.access_token;
    expect((await request.post(base, { headers: { Authorization: `Bearer ${webToken}` }, data: command })).status()).toBe(401);
    expect((await request.post(base, { headers, data: { ...command, accountId: randomUUID() } })).status()).toBe(403);
    expect((await request.post(web, { headers, data: command })).status()).toBe(403);
    expect((await request.post(`${web}/find`, { headers: { cookie: oauth.cookie, origin }, data: lookup })).status()).toBe(403);
    const unrelated = await owner.admin.auth.admin.oauth.createClient({ client_name: `Unrelated explanation fixture ${randomUUID()}`,
      redirect_uris: ["http://127.0.0.1:54329/extension-explanation-http-fixture"], scope: "email", token_endpoint_auth_method: "none" });
    ensure(unrelated.error); unrelatedClientId = unrelated.data!.client_id;
    const foreign = await owner.authorize(unrelatedClientId);
    expect((await request.post(`${base}/find`, { headers: foreign.headers, data: lookup })).status()).toBe(401);
    const started = await request.post(base, { headers, data: command });
    expect(started.status()).toBe(disabled ? 503 : 200);
    if (disabled) expect(await started.json()).toEqual({ ok: false, code: "disabled" });
    else {
      expect(await started.json()).toEqual({ ok: true, runId, status: "ready" });
      const read = await request.get(`${base}/${runId}?accountId=${owner.ownerId}`, { headers });
      expect(read.status()).toBe(200); const projection = await read.json();
      expect(projection.run.result.answer).toEqual(answer);
      const webRead = await request.get(`${web}/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
      expect(webRead.status()).toBe(200); expect((await webRead.json()).run.result).toEqual(projection.run.result);
      expect((await request.post(base, { headers, data: command })).status()).toBe(200);
      expect((await (await request.post(`${base}/find`, { headers, data: lookup })).json()).run.runId).toBe(runId);
      for (const route of ["api/explanations/runs", "api/v1/explanations/runs"]) {
        const traceUrl = new URL(`../.next/server/app/${route}/route.js.nft.json`, import.meta.url);
        const trace: { files: string[] } = JSON.parse(await readFile(traceUrl, "utf8"));
        const skills = trace.files.filter(path => path.endsWith("explain-selection/v1/SKILL.md"));
        expect(skills).toHaveLength(1); await access(new URL(skills[0], traceUrl));
      }
    }
    const { accountId, ...queued } = { ...command, runId: randomUUID() };
    ensure((await owner.client.rpc("begin_explanation_run", { p_request: queued })).error);
    const cancelled = await request.post(`${base}/${queued.runId}`, { headers, data: { operation: "cancel", accountId } });
    expect(cancelled.status()).toBe(200); expect(await cancelled.json()).toEqual({ ok: true, runId: queued.runId, status: "cancelled" });
    const direct = await request.post(`${owner.local.API_URL}/functions/v1/explanation-worker`, { headers, data: { operation: "claim", runId, leaseId: randomUUID() } });
    expect(direct.status()).toBe(403);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toHaveLength(disabled ? 0 : 1);
  } finally {
    try { await owner.cleanup(); }
    finally { if (unrelatedClientId) ensure((await owner.admin.auth.admin.oauth.deleteClient(unrelatedClientId)).error); }
  }
});
