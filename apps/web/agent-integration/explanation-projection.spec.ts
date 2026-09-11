import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { transcriptFixture } from "../transcript-e2e/fixture";
import { readExplanationRun } from "../src/lib/agent/read-explanation-run";

const selection = { start: { segmentIndex: 20, charOffset: 5 }, end: { segmentIndex: 20, charOffset: 17 } };
const answer = { kind: "explanation", meaning: "使用自己的照片解释选择。", reasoning: "原文要求主动解释自己的选择。", background: null,
  checkQuestion: null, limitations: [], evidence: [{ segmentIndex: 20, quote: "自己的照片" }] };
async function projectionFixture(ready = false, lifetime = 600) {
  const owner = await transcriptFixture();
  try {
    if (!/^[a-f0-9-]{36}$/.test(owner.ownerId)) throw new Error("Invalid synthetic owner");
    execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: `insert into private.explanation_run_quotas(owner_id,remaining) values('${owner.ownerId}',1);`, stdio: "pipe", timeout: 15000,
    });
    const sourceRunId = await owner.acquire(lifetime), runId = randomUUID();
    const command = { ...owner.command, runId, sourceRunId, offset: 20, targetLanguage: "zh-Hans", selection, question: "怎样练习？" };
    expect((await owner.client.rpc("begin_explanation_run", { p_request: command })).error).toBeNull();
    if (ready) {
      const instructions = await readFile(new URL("../src/lib/agent/skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8");
      const leaseId = randomUUID(), skill = { name: "blueprint-explain-selection", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
      expect((await owner.admin.rpc("claim_explanation_run", { p_owner_id: owner.ownerId, p_run_id: runId, p_lease_id: leaseId, p_skill: skill, p_model: "projection-fixture" })).error).toBeNull();
      expect((await owner.admin.rpc("finish_explanation_run", { p_owner_id: owner.ownerId, p_run_id: runId, p_lease_id: leaseId,
        p_result: { status: "explained", providerMayHaveRun: true, usage: null, answer } })).error).toBeNull();
    }
    return { owner, command, actor: { userId: owner.ownerId, client: "web" as const } };
  } catch (error) { await owner.cleanup(); throw error; }
}

test("an authorized queued explanation exposes its recoverable question only with a fresh source clock", async () => {
  const { owner, command, actor } = await projectionFixture();
  try {
    const result = await readExplanationRun(owner.client, actor, command.runId, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, run: { runId: command.runId, accountId: owner.ownerId, status: "queued",
      selection, question: "怎样练习？", observedAt: expect.any(String), result: null } });
    if (!result.ok) throw new Error("Projection unavailable");
    expect(Object.keys(result.run).sort()).toEqual(["accountId", "contentExpiresAt", "context", "observedAt", "question", "result", "runId", "selection", "status", "targetLanguage"].sort());
    expect(result.run.context).toEqual({ bindingId: command.bindingId, videoId: command.videoId, sourceRunId: command.sourceRunId, offset: 20 });
  } finally { await owner.cleanup(); }
});

test("a ready explanation exposes its bounded answer but no private execution or full-caption fields", async () => {
  const { owner, command, actor } = await projectionFixture(true);
  try {
    const result = await readExplanationRun(owner.client, actor, command.runId, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, run: { status: "ready", result: { status: "explained", answer }, selection, question: "怎样练习？" } });
    for (const key of ["input_page", "skill", "model", "request_fingerprint", "lease_id", "selected"]) if (result.ok) expect(result.run).not.toHaveProperty(key);
  } finally { await owner.cleanup(); }
});

async function interceptedClient(owner: Awaited<ReturnType<typeof transcriptFixture>>, intercept: (path: string, response: Response) => Promise<Response>) {
  const session = (await owner.client.auth.getSession()).data.session;
  if (!session) throw new Error("Missing fixture session");
  return createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    headers: { Authorization: `Bearer ${session.access_token}` },
    fetch: async (input, init) => intercept(new URL(input instanceof Request ? input.url : String(input)).pathname, await fetch(input, init)),
  } });
}

test.each(["node", "version", "segments"])("fresh source with changed %s never authorizes a stored question or answer", async change => {
  const { owner, command, actor } = await projectionFixture(true);
  try {
    const client = await interceptedClient(owner, async (path, response) => {
      if (!path.endsWith("/rpc/read_learning_transcript") || !response.ok) return response;
      const page = await response.json();
      if (change === "node") page.context.nodeId = randomUUID();
      if (change === "version") page.sourceBlueprintVersion++;
      if (change === "segments") page.segments[0].text = "这不是原始字幕。";
      return Response.json(page);
    });
    expect(await readExplanationRun(client, actor, command.runId, new AbortController().signal)).toEqual({ ok: false, code: "unavailable" });
  } finally { await owner.cleanup(); }
});

test("clearing the source after verification returns a bodyless tombstone, never the earlier ready answer", async () => {
  const { owner, command, actor } = await projectionFixture(true);
  try {
    const client = await interceptedClient(owner, async (path, response) => {
      if (path.endsWith("/rpc/read_learning_transcript") && response.ok) {
        expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: command.sourceRunId })).error).toBeNull();
      }
      return response;
    });
    expect(await readExplanationRun(client, actor, command.runId, new AbortController().signal)).toMatchObject({ ok: true,
      run: { status: "cleared", question: null, selection: null, result: null, observedAt: null } });
  } finally { await owner.cleanup(); }
});

test("a final receipt with a changed question cannot replace the source-authorized request", async () => {
  const { owner, command, actor } = await projectionFixture();
  try {
    let reads = 0;
    const client = await interceptedClient(owner, async (path, response) => {
      if (!path.endsWith("/rpc/read_explanation_run") || !response.ok || ++reads !== 2) return response;
      const receipt = await response.json();
      receipt.question = "这不是原问题。";
      return Response.json(receipt);
    });
    expect(await readExplanationRun(client, actor, command.runId, new AbortController().signal)).toEqual({ ok: false, code: "unavailable" });
  } finally { await owner.cleanup(); }
});

test.each(["source", "final receipt"])("network time spent receiving the %s cannot extend the question lifetime", async stage => {
  const { owner, command, actor } = await projectionFixture(false, 3);
  try {
    let reads = 0;
    const client = await interceptedClient(owner, async (path, response) => {
      const finalRead = path.endsWith("/rpc/read_explanation_run") && ++reads === 2;
      if (stage === "source" && path.endsWith("/rpc/read_learning_transcript") || stage === "final receipt" && finalRead) {
        // Capture an actually valid database response, then simulate a delayed network delivery.
        const payload = await response.json();
        await new Promise(resolve => setTimeout(resolve, 3200));
        return Response.json(payload);
      }
      return response;
    });
    const result = await readExplanationRun(client, actor, command.runId, new AbortController().signal);
    expect(result).toEqual({ ok: false, code: "unavailable" });
  } finally { await owner.cleanup(); }
});

test("a cross-account read and an already aborted request never expose the owner's private question", async () => {
  const { owner, command, actor } = await projectionFixture();
  const other = await transcriptFixture();
  try {
    expect(await readExplanationRun(other.client, { userId: other.ownerId, client: "web" }, command.runId,
      new AbortController().signal)).toEqual({ ok: false, code: "not_found" });
    expect(await readExplanationRun(owner.client, actor, command.runId, AbortSignal.abort())).toEqual({ ok: false, code: "unavailable" });
  } finally { await other.cleanup(); await owner.cleanup(); }
});

test.each(["unavailable", "aborted"])("a source read that becomes %s never exposes even a queued question", async outcome => {
  const { owner, command, actor } = await projectionFixture();
  try {
    const controller = new AbortController();
    const client = await interceptedClient(owner, async (path, response) => {
      if (!path.endsWith("/rpc/read_learning_transcript")) return response;
      if (outcome === "aborted") controller.abort();
      return outcome === "unavailable" ? Response.json({ code: "unavailable" }, { status: 503 }) : response;
    });
    expect(await readExplanationRun(client, actor, command.runId, controller.signal)).toEqual({ ok: false, code: "unavailable" });
  } finally { await owner.cleanup(); }
});

test("cancelling between source verification and final read returns the current cancelled state", async () => {
  const { owner, command, actor } = await projectionFixture();
  try {
    const client = await interceptedClient(owner, async (path, response) => {
      if (path.endsWith("/rpc/read_learning_transcript")) {
        expect((await owner.client.rpc("cancel_explanation_run", { p_run_id: command.runId })).error).toBeNull();
      }
      return response;
    });
    expect(await readExplanationRun(client, actor, command.runId, new AbortController().signal)).toMatchObject({ ok: true,
      run: { status: "cancelled", question: "怎样练习？", result: { status: "cancelled", providerMayHaveRun: false } } });
  } finally { await owner.cleanup(); }
});
