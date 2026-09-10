import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
function sql(query: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: query, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function ensure(error: { code?: string } | null) { if (error) throw new Error(`Local transcript fixture failed: ${error.code ?? "unknown"}`); }

/** Disposable local identity and real Auth/RPC pipeline; never calls a provider. */
export async function transcriptFixture() {
  const local = localSupabaseTestConfig(), admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
  const ownerId = randomUUID(), email = `${ownerId}@learning-transcript.example.test`, password = randomUUID();
  ensure((await admin.auth.admin.createUser({ id: ownerId, email, password, email_confirm: true })).error);
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth });
  async function cleanup() { await client.auth.signOut(); ensure((await admin.auth.admin.deleteUser(ownerId)).error); }
  try {
    ensure((await client.auth.signInWithPassword({ email, password })).error);
    let response = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: ownerId });
    for (let index = 0; response.error?.code === "PGRST303" && index < 5; index++) {
      await new Promise(resolve => setTimeout(resolve, 500)); response = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: ownerId });
    }
    ensure(response.error); const blank = response.data;
    const goalId = randomUUID(), nodeId = randomUUID(), bindingId = randomUUID(), videoId = "abcdefghijk";
    const draft = { ...blank, goals: [{ id: goalId, title: "用影像讲述生活", position: 0, stages: [{ id: randomUUID(), title: "理解光线", position: 0,
      nodes: [{ id: nodeId, title: "观察曝光与快门", type: "learn", position: 0, estimatedMinutes: 30, completionCriteria: "拍摄并解释三组曝光对比", dependencyIds: [],
        resources: [{ id: bindingId, kind: "youtube_video", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }] }] }] }] };
    const proposal = randomUUID();
    ensure((await client.from("blueprint_proposals").insert({ id: proposal, owner_id: ownerId, blueprint_id: blank.id, base_version: 0, proposed_snapshot: draft, client_mutation_id: randomUUID() })).error);
    ensure((await client.rpc("apply_blueprint_proposal", { proposal_id: proposal, expected_version: 0, mutation_id: randomUUID() })).error);
    sql(`insert into private.resource_quotas values('${ownerId}','discover',8); insert into private.resource_retention_policies values('${ownerId}',600,'local-transcript-fixture-only');`);
    const command = { bindingId, videoId };
    async function acquire(windowSeconds = 600) {
      if (![1, 3, 600].includes(windowSeconds)) throw new Error("Unexpected fixture lifetime");
      sql(`update private.resource_retention_policies set window_seconds=${windowSeconds} where owner_id='${ownerId}';`);
      const current = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: ownerId }); ensure(current.error);
      const runId = randomUUID(), leaseId = randomUUID();
      ensure((await client.rpc("begin_resource_run", { p_request: { kind: "discover", runId, nodeId, expectedBlueprintVersion: current.data.version,
        preferences: { regionCode: "US", language: "en", allowLanguageFallback: false, maxDurationSeconds: 3600, publishedAfter: null },
        learnerContext: { startingPoint: null, constraints: null } } })).error);
      const claimed = await admin.rpc("claim_resource_run", { p_owner_id: ownerId, p_run_id: runId, p_lease_id: leaseId, p_skill: null }); ensure(claimed.error);
      const result = { status: "discovered", source: { blueprintId: blank.id, blueprintVersion: current.data.version, nodeId, checkedAt: claimed.data.observed_at },
        requests: { catalogMayHaveRun: true, transcriptVideoIds: [videoId] }, rejected: [], uninspectedVideoIds: [], candidates: [{
          video: { videoId, title: "Exposure · 从光线开始理解画面", description: "Controlled original caption fixture", channelId: "fixture", channelTitle: "Learning Studio",
            publishedAt: "2024-01-01T00:00:00Z", durationSeconds: 600, audioLanguage: "en", defaultLanguage: "en", captionAvailable: true,
            privacyStatus: "public", uploadStatus: "processed", liveBroadcastContent: "none", embeddable: true, allowedRegions: null, blockedRegions: [], ageRestricted: false,
            statistics: { viewCount: null, likeCount: null, commentCount: null } },
          url: `https://www.youtube.com/watch?v=${videoId}`, languageFallback: false, eligibleForMatching: true, matching: "not_evaluated",
          transcript: { status: "ready", language: "en", availableLanguages: ["en"], segments: Array.from({ length: 21 }, (_, index) => ({
            text: index === 20 ? "最后一段：用自己的照片解释你的选择。" : `${index + 1}. Observe the light before changing exposure. 对比亮部与暗部，记录你观察到的差异。`, offset: index * 15000, duration: 10000,
          })) },
        }] };
      const finished = await admin.rpc("finish_resource_run", { p_owner_id: ownerId, p_run_id: runId, p_lease_id: leaseId, p_result: result }); ensure(finished.error);
      if (finished.data.status !== "ready") throw new Error("Fixture did not produce readable evidence");
      return runId;
    }
    return { local, ownerId, email, password, client, admin, goalId, nodeId, bindingId, videoId, command, acquire, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
