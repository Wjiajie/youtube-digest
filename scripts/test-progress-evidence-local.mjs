import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Local-only integration: never load a linked project's credentials or touch a
// pre-existing account. The isolated fixture is deleted even after a failed check.
function sql(query) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const local = JSON.parse(execFileSync(process.env.BLUEPRINT_SUPABASE_BIN ?? "supabase", ["status", "-o", "json"], {
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
}));
assert.equal(local.API_URL, "http://127.0.0.1:54321", "integration checks must target the local stack");
const jwtSecret = local.JWT_SECRET, anonKey = local.ANON_KEY;
assert.ok(jwtSecret && anonKey, "Local API credentials must be available (never print them)");
function clientFor(userId) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 120 })).toString("base64url");
  const token = `${header}.${payload}.${createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url")}`;
  return createClient("http://127.0.0.1:54321", anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
const owner = randomUUID(), outsider = randomUUID(), goal = randomUUID(), stage = randomUUID(), node = randomUUID(), mutation = randomUUID();
let created = false;
try {
  sql(`begin;
    insert into auth.users (id, email) values ('${owner}', '${owner}@evidence.example.test'), ('${outsider}', '${outsider}@evidence.example.test');
    insert into public.goals (id, owner_id, blueprint_id, title, position)
      select '${goal}', owner_id, id, '独立集成测试', 0 from public.blueprints where owner_id = '${owner}';
    insert into public.stages (id, owner_id, goal_id, title, position) values ('${stage}', '${owner}', '${goal}', '第一周', 0);
    insert into public.path_nodes (id, owner_id, stage_id, node_type, title, position) values ('${node}', '${owner}', '${stage}', 'practice', '演讲练习', 0);
    commit;`);
  created = true;
  const client = clientFor(owner);
  const arguments_ = { p_node_id: node, p_expected_version: 0, p_evidence_text: "完成首次练习", p_artifact_url: null, p_client_mutation_id: mutation };
  const responses = await Promise.all([
    client.rpc("record_progress_evidence", arguments_),
    client.rpc("record_progress_evidence", arguments_),
  ]);
  for (const { data, error } of responses) {
    assert.equal(error, null, "real PostgREST RPC must succeed");
    assert.equal(data.node_title, "演讲练习");
    assert.equal(data.node_type, "practice");
    assert.equal(data.blueprint_version, 0);
  }
  assert.equal(responses[0].data.id, responses[1].data.id, "concurrent requests return the same receipt");
  const read = await client.from("progress_evidence").select("id,evidence_text");
  assert.equal(read.error, null);
  assert.deepEqual(read.data, [{ id: responses[0].data.id, evidence_text: "完成首次练习" }]);
  const other = await clientFor(outsider).from("progress_evidence").select("id");
  assert.equal(other.error, null);
  assert.deepEqual(other.data, [], "a real second JWT cannot read the first account's record");
  console.log("Local evidence integration passed: real SDK/PostgREST, concurrent idempotency, historical context, two-account RLS.");
} finally {
  if (created) {
    sql(`delete from auth.users where id in ('${owner}', '${outsider}');`);
    assert.equal(sql(`select count(*) from auth.users where id in ('${owner}', '${outsider}')`), "0");
    console.log("Removed only this run's two temporary local accounts and their cascaded test records.");
  }
}
