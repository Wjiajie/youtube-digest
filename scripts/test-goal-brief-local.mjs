import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseTestConfig } from "./local-supabase-test-config.mjs";

// This only uses the local stack. Auth creates disposable confirmed-email users;
// it sends no emails and does not grant or bypass access on the hosted project.
const local = localSupabaseTestConfig();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
const users = [];
const clients = [];
async function newClient() {
  const id = randomUUID(), email = `brief-${id}@example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  assert.equal(created.error, null); assert.equal(created.data.user.id, id);
  users.push(id);
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, options);
  clients.push(client);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
  // Local PostgREST can transiently reject a fresh Auth token (PGRST303).
  // Wait for a real read to succeed with that SAME session before testing writes;
  // never alter token claims, retry a write, or hide any other provider failure.
  for (let attempt = 0; ; attempt++) {
    const probe = await client.from("blueprints").select("id").single();
    if (!probe.error) break;
    if (attempt >= 5 || probe.error.code !== "PGRST303" || probe.error.message !== "JWT issued at future") {
      assert.fail(`Local session readiness failed: ${probe.error.code}`);
    }
    console.log("Local session not yet accepted by PostgREST (PGRST303); retrying only the read readiness check.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return client;
}
try {
  const client = await newClient();
  const other = await newClient();
  const content = { schemaVersion: 1, outcome: "准备一次公开演讲", startingPoint: "只有课堂经验", targetDate: null,
    weeklyMinutes: 180, constraints: "", successCriteria: "完成录制并获得三人反馈" };
  const command = { p_id: randomUUID(), p_expected_revision: 0, p_content: content, p_confirm: true, p_client_mutation_id: randomUUID() };
  const saved = await Promise.all([client.rpc("save_goal_brief", command), client.rpc("save_goal_brief", command)]);
  for (const response of saved) assert.equal(response.error, null);
  assert.deepEqual(saved[0].data, saved[1].data, "simultaneous duplicate requests receive one exact receipt");
  assert.equal(saved[0].data.revision, 1);
  assert.equal(saved[0].data.status, "confirmed");
  const attempts = await Promise.all([
    client.rpc("save_goal_brief", { ...command, p_expected_revision: 1, p_confirm: false, p_client_mutation_id: randomUUID() }),
    client.rpc("save_goal_brief", { ...command, p_expected_revision: 1, p_confirm: false, p_client_mutation_id: randomUUID() }),
  ]);
  assert.equal(attempts.filter(result => result.error === null).length, 1, "only one competing edit can claim a revision");
  assert.equal(attempts.find(result => result.error)?.error.code, "40001");
  const replay = await client.rpc("save_goal_brief", command);
  assert.equal(replay.error, null); assert.deepEqual(replay.data, saved[0].data);
  const latest = await client.from("goal_briefs").select("revision,status,content").eq("id", command.p_id).single();
  assert.equal(latest.error, null);
  assert.deepEqual(latest.data, { revision: 2, status: "draft", content });
  const foreign = await other.from("goal_briefs").select("id");
  assert.equal(foreign.error, null); assert.deepEqual(foreign.data, []);
  const wrongOwner = await other.rpc("save_goal_brief", { ...command, p_expected_revision: 2, p_client_mutation_id: randomUUID() });
  assert.equal(wrongOwner.error?.code, "P0002");
  const blueprint = await client.from("blueprints").select("version").single();
  assert.equal(blueprint.error, null); assert.equal(blueprint.data.version, 0);
  console.log("PASS: real local Auth/SDK/PostgREST confirms a definition, deduplicates retries, serializes conflicting edits and isolates accounts; formal Blueprint unchanged.");
} finally {
  await Promise.allSettled(clients.map(client => client.auth.signOut()));
  const cleanupErrors = [];
  for (const id of users) {
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) cleanupErrors.push(id);
  }
  assert.deepEqual(cleanupErrors, [], "all temporary accounts must be cleaned up");
  console.log("Removed only this run's temporary local accounts and cascaded Goal Brief records; no email sent.");
}
