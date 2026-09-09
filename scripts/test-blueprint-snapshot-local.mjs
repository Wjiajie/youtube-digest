// Local-only, actual PostgreSQL concurrency test. No email, HTTP Auth or hosted DB.
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { spawn } from "node:child_process";

const container = "supabase_db_blueprint-local";
const owner = randomUUID();
const readerName = `snapshot-test-${owner}`;
const lockId = randomInt(1, 2_000_000_000);
const processes = new Set();
const identity = `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${owner}"}', false);`;
const quoteJson = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function start(sql, { keepOpen = false } = {}) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  processes.add(child);
  let output = "";
  let error = "";
  const timer = setTimeout(() => child.kill(), 20_000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer); processes.delete(child);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Local PostgreSQL test failed (${code}): ${error.slice(0, 1200)}`));
    });
  });
  // Keep early process failures handled while the orchestrator waits for a gate.
  void done.catch(() => {});
  child.stdin.write(sql + "\n");
  if (!keepOpen) child.stdin.end();
  return { child, done, output: () => output };
}
const query = async sql => start(sql).done;
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Local concurrency gate did not become observable");
}
const fingerprint = () => query("select md5(coalesce(string_agg(id::text || ':' || version::text, ',' order by id), '')) from public.blueprints;");
const original = await fingerprint();
let locker;
let reader;
try {
  await query(`insert into auth.users(id, email) values ('${owner}', 'snapshot-${owner}@example.test');`);
  const blueprintId = await query(`select id from public.blueprints where owner_id = '${owner}';`);
  const goalId = randomUUID();
  const initial = { schemaVersion: 1, id: blueprintId, version: 0, title: "First revision", goals: [
    { id: goalId, title: "Old goal", position: 0, stages: [] },
  ] };
  async function apply(snapshot) {
    const proposal = randomUUID();
    await query(`${identity}
      insert into public.blueprint_proposals(id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
      values ('${proposal}', '${owner}', '${blueprintId}', ${snapshot.version}, ${quoteJson(snapshot)}, '${randomUUID()}');
      select public.apply_blueprint_proposal('${proposal}', ${snapshot.version}, '${randomUUID()}');`);
  }
  await apply(initial);
  locker = start(`begin; select pg_advisory_xact_lock(${lockId}); select 'LOCKED';`, { keepOpen: true });
  await until(() => locker.output().includes("LOCKED"));
  reader = start(`${identity}
    set application_name = '${readerName}';
    with gate as materialized (select pg_advisory_xact_lock_shared(${lockId}))
    select public.read_blueprint_snapshot('${owner}') from gate;`);
  // The waiting SELECT has established its MVCC snapshot before the writer commits.
  await until(async () => (await query(`select count(*) from pg_stat_activity where application_name = '${readerName}' and wait_event_type = 'Lock' and wait_event = 'advisory';`)) === "1");
  const changed = structuredClone(initial);
  changed.version = 1; changed.title = "Second revision"; changed.goals[0].title = "New goal";
  await apply(changed);
  locker.child.stdin.end("commit;\n");
  await locker.done;
  const oldRead = JSON.parse((await reader.done).split("\n").at(-1));
  assert.deepEqual(oldRead, { ...initial, version: 1 }, "the waiting read retains one whole old revision, not new nested rows");
  const newRead = JSON.parse((await query(`${identity} select public.read_blueprint_snapshot('${owner}');`)).split("\n").at(-1));
  assert.deepEqual(newRead, { ...changed, version: 2 }, "a new statement observes the whole committed revision");
  console.log("PASS: real concurrent confirmation/read returns coherent old then new Blueprint revisions");
} finally {
  // Cancel only this test's named reader and release only its own advisory lock.
  if (reader) await query(`select pg_cancel_backend(pid) from pg_stat_activity where application_name = '${readerName}';`);
  if (locker && !locker.child.stdin.destroyed) locker.child.stdin.end("rollback;\n");
  await Promise.allSettled([locker?.done, reader?.done]);
  for (const child of processes) child.kill();
  await query(`delete from auth.users where id = '${owner}' and email = 'snapshot-${owner}@example.test';`);
  assert.equal(await fingerprint(), original, "all pre-existing Blueprint identities and versions are preserved");
  console.log("PASS: this run's temporary account and cascaded fixtures removed; existing Blueprints preserved");
}
