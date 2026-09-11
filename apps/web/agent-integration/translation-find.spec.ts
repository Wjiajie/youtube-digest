import { test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { transcriptFixture } from "../transcript-e2e/fixture";

test("a fresh real Auth session finds the newest pinned-page run without a browser run-ID index", async () => {
  const owner = await transcriptFixture();
  let other: Awaited<ReturnType<typeof transcriptFixture>> | undefined;
  const secondSession = createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    other = await transcriptFixture();
    const request = { ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans" };
    expect(await owner.client.rpc("find_translation_run", { p_request: request })).toMatchObject({ data: { run_id: null }, error: null });
    execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: `insert into private.translation_run_quotas(owner_id,remaining) values('${owner.ownerId}',1);`, stdio: ["pipe", "pipe", "pipe"],
    });
    const first = randomUUID(), latest = randomUUID();
    expect((await owner.client.rpc("begin_translation_run", { p_request: { ...request, runId: first } })).error).toBeNull();
    expect((await owner.client.rpc("cancel_translation_run", { p_run_id: first })).error).toBeNull();
    expect((await owner.client.rpc("begin_translation_run", { p_request: { ...request, runId: latest } })).error).toBeNull();
    expect((await owner.client.rpc("cancel_translation_run", { p_run_id: latest })).error).toBeNull();
    expect((await secondSession.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
    const found = await secondSession.rpc("find_translation_run", { p_request: request });
    expect(found.error).toBeNull(); expect(found.data).toEqual({ run_id: latest });
    expect((await secondSession.rpc("read_translation_run", { p_run_id: found.data.run_id })).data.status).toBe("cancelled");
    expect(await other.client.rpc("find_translation_run", { p_request: request })).toMatchObject({ data: { run_id: null }, error: null });
    expect((await secondSession.rpc("find_translation_run", { p_request: { ...request, accountId: owner.ownerId } })).error?.code).toBe("22023");
    expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: request.sourceRunId })).error).toBeNull();
    expect((await secondSession.rpc("find_translation_run", { p_request: request })).data).toEqual({ run_id: latest });
    const cleared = await secondSession.rpc("read_translation_run", { p_run_id: latest });
    expect(cleared.error).toBeNull(); expect(cleared.data).toMatchObject({ status: "cleared", input_page: null, result: null });
  } finally {
    await secondSession.auth.signOut();
    try { await owner.cleanup(); } finally { await other?.cleanup(); }
  }
});
