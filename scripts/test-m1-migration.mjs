import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  owner: "018f6f68-9b4d-7c93-a134-c8571b8f7701",
  outsider: "018f6f68-9b4d-7c93-a134-c8571b8f7702",
  goal: "018f6f68-9b4d-7c93-a134-c8571b8f7711",
  stage: "018f6f68-9b4d-7c93-a134-c8571b8f7712",
  node: "018f6f68-9b4d-7c93-a134-c8571b8f7713",
  resource: "018f6f68-9b4d-7c93-a134-c8571b8f7714",
  proposal: "018f6f68-9b4d-7c93-a134-c8571b8f7715",
  invalidProposal: "018f6f68-9b4d-7c93-a134-c8571b8f7719",
  createMutation: "018f6f68-9b4d-7c93-a134-c8571b8f7716",
  applyMutation: "018f6f68-9b4d-7c93-a134-c8571b8f7717",
  invalidCreateMutation: "018f6f68-9b4d-7c93-a134-c8571b8f7720",
  invalidApplyMutation: "018f6f68-9b4d-7c93-a134-c8571b8f7721",
  sessionMutation: "018f6f68-9b4d-7c93-a134-c8571b8f7718",
};

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema extensions;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to authenticated, service_role;
  `);

  const rawMigration = await readFile(
    new URL("../supabase/migrations/202608260001_m1_cloud_slice.sql", import.meta.url),
    "utf8",
  );
  const portableMigration = rawMigration
    .replace("create extension if not exists citext with schema extensions;", "")
    .replaceAll("extensions.citext", "text");
  await db.exec(portableMigration);

  await db.query("insert into private.invite_allowlist (email) values ('owner@example.com')");
  await db.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    ids.owner,
    "owner@example.com",
    ids.outsider,
    "outsider@example.com",
  ]);
  // Upgrade already-created accounts with every subsequent migration. The test
  // deliberately does not recreate their data after adding new schema fields.
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === "202608260001_m1_cloud_slice.sql") continue;
    const legacy = file.endsWith("_node_planning_metadata.sql") ? await seedLegacyPlanningUpgrade() : null;
    const statusUpgrade = file.endsWith("_node_status_confirmations.sql") ? await seedStatusUpgrade() : null;
    const clarificationUpgrade = file.endsWith("_goal_clarification_sessions.sql") ? await seedClarificationUpgrade() : null;
    const resourceUpgrade = file.endsWith("_resource_runs.sql") ? await captureResourceUpgrade() : null;
    const adoptionUpgrade = file.endsWith("_resource_adoption.sql") ? await seedAdoptionUpgrade() : null;
    const resourceOrderUpgrade = file.endsWith("_resource_order.sql") ? await seedResourceOrderUpgrade() : null;
    const notesUpgrade = file.endsWith("_learning_notes.sql") ? await captureResourceUpgrade() : null;
    const clearingUpgrade = file.endsWith("_resource_evidence_clearing.sql") ? await seedResourceClearingUpgrade() : null;
    const positionsUpgrade = file.endsWith("_learning_positions.sql") ? await captureResourceUpgrade() : null;
    const migration = await readFile(new URL(file, migrationDirectory), "utf8");
    await db.exec(migration.replaceAll("extensions.citext", "text"));
    if (legacy) await verifyLegacyPlanningUpgrade(legacy);
    if (statusUpgrade) await verifyStatusUpgrade(statusUpgrade);
    if (clarificationUpgrade) await verifyClarificationUpgrade(clarificationUpgrade);
    if (resourceUpgrade) await verifyResourceUpgrade(resourceUpgrade);
    if (adoptionUpgrade) await verifyAdoptionUpgrade(adoptionUpgrade);
    if (resourceOrderUpgrade) await verifyResourceOrderUpgrade(resourceOrderUpgrade);
    if (notesUpgrade) await verifyLearningNotesUpgrade(notesUpgrade);
    if (clearingUpgrade) await verifyResourceClearingUpgrade(clearingUpgrade);
    if (positionsUpgrade) await verifyLearningPositionsUpgrade(positionsUpgrade);
  }
  const returningInvite = await db.query(
    "select public.is_email_invited('owner@example.com') as allowed, used_by from private.invite_allowlist where email = 'owner@example.com'",
  );
  assert.equal(returningInvite.rows[0]?.allowed, true, "a used invite still permits returning login");
  assert.equal(returningInvite.rows[0]?.used_by, ids.owner, "creating the invited Auth user consumes the invite");
  const blueprint = await db.query(
    "select id from public.blueprints where owner_id = $1",
    [ids.owner],
  );
  const blueprintId = blueprint.rows[0]?.id;
  assert.ok(blueprintId, "new users receive a main Blueprint");

  await becomeUser(ids.owner);
  await assert.rejects(
    () => db.query(
      "insert into public.goals (id, owner_id, blueprint_id, title, position) values ($1, $2, $3, 'bypass', 0)",
      [ids.goal, ids.owner, blueprintId],
    ),
    /permission denied/,
    "formal entities must not bypass a confirmed proposal",
  );

  const snapshot = {
    schemaVersion: 2,
    id: blueprintId,
    version: 0,
    title: "职业成长蓝图",
    goals: [{
      id: ids.goal,
      title: "成为数据分析师",
      position: 0,
      stages: [{
        id: ids.stage,
        title: "验证基础",
        position: 0,
        nodes: [{
          id: ids.node,
          type: "learn",
          title: "理解分析流程",
          estimatedMinutes: 45,
          completionCriteria: "解释分析流程并完成一次练习",
          position: 0,
          dependencyIds: [],
          resources: [{
            id: ids.resource,
            kind: "youtube_video",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            externalId: "dQw4w9WgXcQ",
          }],
        }],
      }],
    }],
  };
  await db.query(`
    insert into public.blueprint_proposals (
      id, owner_id, blueprint_id, base_version, proposed_snapshot,
      client_mutation_id
    ) values ($1, $2, $3, 0, $4, $5)
  `, [ids.proposal, ids.owner, blueprintId, snapshot, ids.createMutation]);
  // Exercise the migrated public RPC, not just the TypeScript request validator.
  // No extension client configuration exists in this upgrade fixture.
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ client_id: "unconfigured-oauth-client" }),
  ]);
  await assert.rejects(
    () => db.query("select public.apply_blueprint_proposal($1, 0, $2)", [ids.proposal, ids.applyMutation]),
    /BLUEPRINT_FORBIDDEN/,
    "missing client configuration cannot promote an OAuth session into the Web flow",
  );
  const deniedPreference = await db.query("update public.profiles set theme_id = 'eastern' returning id");
  assert.equal(deniedPreference.rows.length, 0, "OAuth sessions cannot modify Web-owned preferences");
  await becomeUser(ids.owner);
  await assert.rejects(
    () => db.query("select public.apply_blueprint_proposal($1, null, $2)", [ids.proposal, ids.applyMutation]),
    /PROPOSAL_ARGUMENTS_INVALID/,
    "NULL expected_version cannot disable optimistic concurrency",
  );
  const missingIdentity = structuredClone(snapshot);
  delete missingIdentity.id;
  const missingGoals = structuredClone(snapshot);
  delete missingGoals.goals;
  for (const [malformed, message] of [
    [missingIdentity, /BLUEPRINT_ID_MISMATCH/],
    [missingGoals, /BLUEPRINT_SNAPSHOT_INVALID/],
  ]) {
    await db.query("update public.blueprint_proposals set proposed_snapshot = $1 where id = $2", [malformed, ids.proposal]);
    await assert.rejects(
      () => db.query("select public.apply_blueprint_proposal($1, 0, $2)", [ids.proposal, ids.applyMutation]),
      message,
      "incomplete snapshots cannot become formal revisions",
    );
  }
  await db.query("update public.blueprint_proposals set proposed_snapshot = $1 where id = $2", [snapshot, ids.proposal]);
  const applied = await db.query(
    "select public.apply_blueprint_proposal($1, 0, $2) as version",
    [ids.proposal, ids.applyMutation],
  );
  assert.equal(applied.rows[0]?.version, 1, "confirmed proposal increments the version once");
  const replay = await db.query(
    "select public.apply_blueprint_proposal($1, 0, $2) as version",
    [ids.proposal, ids.applyMutation],
  );
  assert.equal(replay.rows[0]?.version, 1, "proposal application is idempotent");

  const coherentRead = await db.query("select public.read_blueprint_snapshot_v2($1) as snapshot", [ids.owner]);
  assert.deepEqual(coherentRead.rows[0]?.snapshot, { ...snapshot, version: 1 },
    "upgraded existing accounts read one complete confirmed Blueprint snapshot");
  assert.equal((await db.query("select public.read_blueprint_snapshot_v2($1) as snapshot", [ids.outsider])).rows[0]?.snapshot, null,
    "the new snapshot RPC cannot widen owner access");
  const readPermissions = await db.query("select has_function_privilege('anon', 'public.read_blueprint_snapshot_v2(uuid)', 'EXECUTE') as allowed");
  assert.equal(readPermissions.rows[0]?.allowed, false, "generated migration explicitly denies anonymous snapshot reads");

  const briefContent = { schemaVersion: 1, outcome: "完成一次独立分析", startingPoint: "刚接触分析工具",
    targetDate: null, weeklyMinutes: 180, constraints: "", successCriteria: "能够解释分析结论与限制" };
  const brief = await db.query("select * from public.save_goal_brief($1, 0, $2, true, $3)", [ids.goal, briefContent, ids.createMutation]);
  assert.equal(brief.rows[0]?.status, "confirmed", "existing accounts can explicitly confirm a Goal Brief after upgrade");
  assert.equal(brief.rows[0]?.revision, 1);
  const briefReplay = await db.query("select * from public.save_goal_brief($1, 0, $2, true, $3)", [ids.goal, briefContent, ids.createMutation]);
  assert.deepEqual(briefReplay.rows, brief.rows, "Goal Brief upgrade preserves exact retry receipts");
  await assert.rejects(() => db.query("update public.goal_briefs set status = 'draft'"), /permission denied/,
    "Goal Brief state cannot bypass its guarded mutation");
  assert.equal((await db.query("select version from public.blueprints")).rows[0]?.version, 1,
    "confirming a definition does not create a Blueprint revision");
  const briefPermissions = await db.query(`select
    has_table_privilege('anon', 'public.goal_briefs', 'SELECT') as anon_read,
    has_function_privilege('anon', 'public.save_goal_brief(uuid,integer,jsonb,boolean,uuid)', 'EXECUTE') as anon_rpc,
    has_table_privilege('authenticated', 'private.goal_brief_mutations', 'SELECT') as client_receipts`);
  assert.deepEqual(briefPermissions.rows[0], { anon_read: false, anon_rpc: false, client_receipts: false },
    "the generated migration retains explicit privacy ACLs");

  const evidence = await db.query(
    "select * from public.record_progress_evidence($1, 1, '已完成一次独立练习', null, $2)",
    [ids.node, ids.sessionMutation],
  );
  assert.equal(evidence.rows[0]?.node_title, "理解分析流程", "upgraded accounts can record server-owned historical context");
  const evidenceReplay = await db.query(
    "select * from public.record_progress_evidence($1, 1, '已完成一次独立练习', null, $2)",
    [ids.node, ids.sessionMutation],
  );
  assert.equal(evidenceReplay.rows[0]?.id, evidence.rows[0]?.id, "upgraded evidence RPC is idempotent");
  await assert.rejects(() => db.query("update public.progress_evidence set evidence_text = 'forged'"), /permission denied/,
    "migration preserves the direct-write deny rule");
  const evidencePermissions = await db.query(`select
    has_function_privilege('anon', 'public.record_progress_evidence(uuid,bigint,text,text,uuid)', 'EXECUTE') as anon_rpc,
    has_function_privilege('anon', 'private.record_progress_evidence(uuid,bigint,text,text,uuid)', 'EXECUTE') as anon_private,
    has_table_privilege('anon', 'public.progress_evidence', 'SELECT') as anon_read`);
  assert.deepEqual(evidencePermissions.rows[0], { anon_rpc: false, anon_private: false, anon_read: false },
    "generated migration explicitly removes default public access");

  await db.query(`
    insert into public.learning_sessions (
      owner_id, node_id, resource_binding_id, source, started_at, client_mutation_id
    ) values ($1, $2, $3, 'extension', now(), $4)
  `, [ids.owner, ids.node, ids.resource, ids.sessionMutation]);
  await assert.rejects(
    () => db.query(
      "update public.learning_sessions set status = 'ended' where owner_id = $1",
      [ids.owner],
    ),
    /permission denied/,
    "M1 clients may append sessions but cannot rewrite recorded sessions",
  );

  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.version = 1;
  invalidSnapshot.goals[0].stages[0].nodes[0].resources[0].externalId = "AAAAAAAAAAA";
  await db.query(`
    insert into public.blueprint_proposals (
      id, owner_id, blueprint_id, base_version, proposed_snapshot,
      client_mutation_id
    ) values ($1, $2, $3, 1, $4, $5)
  `, [ids.invalidProposal, ids.owner, blueprintId, invalidSnapshot, ids.invalidCreateMutation]);
  await assert.rejects(
    () => db.query(
      "select public.apply_blueprint_proposal($1, 1, $2)",
      [ids.invalidProposal, ids.invalidApplyMutation],
    ),
    /resource_bindings_url_external_id_match|check constraint/,
    "the database rejects a YouTube URL whose video ID does not match external_id",
  );
  const versionAfterRejectedProposal = await db.query(
    "select version from public.blueprints where owner_id = $1",
    [ids.owner],
  );
  assert.equal(versionAfterRejectedProposal.rows[0]?.version, 1, "a rejected resource proposal is atomic");

  await db.exec("reset role");
  await becomeUser(ids.outsider);
  const isolated = await db.query("select count(*)::integer as count from public.goals");
  assert.equal(isolated.rows[0]?.count, 0, "RLS hides another user's goals");
  await assert.rejects(
    () => db.query(`
      insert into public.learning_sessions (
        owner_id, node_id, source, started_at, client_mutation_id
      ) values ($1, $2, 'extension', now(), gen_random_uuid())
    `, [ids.outsider, ids.node]),
    /violates row-level security|foreign key constraint/,
    "a user cannot write a session against another user's node",
  );

  await db.exec("reset role");
  await becomeUser(ids.owner);
  const preferences = await db.query("select theme_id, theme_version, preferences_revision from public.profiles");
  assert.equal(preferences.rows[0]?.theme_id, "cyberpunk", "existing accounts receive the default theme");
  assert.equal(Number(preferences.rows[0]?.preferences_revision), 0);
  const saved = await db.query("update public.profiles set theme_id = 'eastern' where preferences_revision = 0 returning theme_id, preferences_revision");
  assert.equal(saved.rows[0]?.theme_id, "eastern", "the generated migration preserves the column UPDATE grant");
  assert.equal(Number(saved.rows[0]?.preferences_revision), 1);
  const stale = await db.query("update public.profiles set theme_id = 'cyberpunk' where preferences_revision = 0 returning id");
  assert.equal(stale.rows.length, 0, "a stale preference write cannot replace a newer choice");
  const unchangedBlueprint = await db.query("select version from public.blueprints");
  assert.equal(Number(unchangedBlueprint.rows[0]?.version), 1, "preferences do not revise the Blueprint");

  console.log("Migration contract passed: proposal input guards, OAuth restrictions, idempotency, ownership, RLS, and existing-account preferences upgrade.");
} finally {
  await db.close();
}

async function becomeUser(userId) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', '{}', false)");
}

async function seedLegacyPlanningUpgrade() {
  const owner = "d9000000-0000-4000-8000-000000000101";
  const proposal = "d9000000-0000-4000-8000-000000000140";
  const pending = "d9000000-0000-4000-8000-000000000141";
  const mutation = "d9000000-0000-4000-8000-000000000160";
  await db.query("insert into auth.users(id,email) values($1,'legacy-planning@example.test')", [owner]);
  await becomeUser(owner);
  const root = (await db.query("select id from public.blueprints")).rows[0].id;
  const snapshot = { schemaVersion: 1, id: root, version: 0, title: "Pre-upgrade path", goals: [{
    id: "d9000000-0000-4000-8000-000000000110", title: "Existing goal", position: 0, stages: [{
      id: "d9000000-0000-4000-8000-000000000120", title: "Existing stage", position: 0, nodes: [{
        id: "d9000000-0000-4000-8000-000000000130", title: "Existing reflection", type: "reflection",
        position: 0, dependencyIds: [], resources: [],
      }],
    }],
  }] };
  await db.query("insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id) values($1,$2,$3,0,$4,gen_random_uuid())", [proposal, owner, root, snapshot]);
  await db.query("select public.apply_blueprint_proposal($1,0,$2)", [proposal, mutation]);
  const current = { ...snapshot, version: 1 };
  await db.query("insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id) values($1,$2,$3,1,$4,gen_random_uuid())", [pending, owner, root, current]);
  const before = (await db.query("select to_jsonb(b) as root, (select jsonb_agg(to_jsonb(p) order by id) from public.blueprint_proposals p) as proposals, (select jsonb_agg(to_jsonb(r) order by id) from public.blueprint_revisions r) as revisions from public.blueprints b")).rows[0];
  await db.exec("reset role");
  return { owner, proposal, pending, mutation, current, before };
}

async function verifyLegacyPlanningUpgrade({ owner, proposal, pending, mutation, current, before }) {
  await becomeUser(owner);
  const after = (await db.query("select to_jsonb(b) as root, (select jsonb_agg(to_jsonb(p) order by id) from public.blueprint_proposals p) as proposals, (select jsonb_agg(to_jsonb(r) order by id) from public.blueprint_revisions r) as revisions from public.blueprints b")).rows[0];
  assert.deepEqual(after, before, "schema upgrade preserves the existing root and exact historical v1 proposal/revision JSON");
  assert.deepEqual((await db.query("select public.read_blueprint_snapshot($1) as value", [owner])).rows[0].value, current,
    "the old read projection still supports existing clients");
  const expected = structuredClone(current);
  expected.schemaVersion = 2;
  Object.assign(expected.goals[0].stages[0].nodes[0], { estimatedMinutes: null, completionCriteria: "" });
  assert.deepEqual((await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value, expected,
    "existing nodes read as v2 with explicit unknown metadata without creating a revision");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal($1,0,$2) as version", [proposal, mutation])).rows[0].version), 1,
    "an already-applied legacy request still replays before the new format gate");
  await assert.rejects(() => db.query("select public.apply_blueprint_proposal($1,1,gen_random_uuid())", [pending]), /BLUEPRINT_SNAPSHOT_INVALID/,
    "a legacy pending proposal cannot strip new metadata through the old format");
  assert.deepEqual((await db.query("select to_jsonb(b) as root, (select jsonb_agg(to_jsonb(p) order by id) from public.blueprint_proposals p) as proposals, (select jsonb_agg(to_jsonb(r) order by id) from public.blueprint_revisions r) as revisions from public.blueprints b")).rows[0], before,
    "replaying and rejecting legacy requests do not change any existing state");
  await db.exec("reset role");
}

async function captureStatusUpgrade() {
  await db.exec("reset role");
  const before = {};
  // Include existing legacy applied/pending proposal JSON, formal graph, account
  // metadata and independent histories. No fixture data is recreated after DDL.
  for (const table of ["profiles", "blueprints", "goals", "stages", "path_nodes", "resource_bindings",
    "path_node_dependencies", "blueprint_proposals", "blueprint_revisions", "learning_sessions", "progress_evidence", "goal_briefs"]) {
    before[table] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from public.${table} t`)).rows[0].rows;
  }
  return before;
}

async function seedStatusUpgrade() {
  const owner = "d9000000-0000-4000-8000-000000000101";
  const proposal = "d9000000-0000-4000-8000-000000000142";
  await becomeUser(owner);
  const snapshot = (await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value;
  const node = snapshot.goals[0].stages[0].nodes[0];
  node.estimatedMinutes = 90;
  node.completionCriteria = "Explain the result and its limits";
  await db.query("insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id) values($1,$2,$3,1,$4,gen_random_uuid())", [proposal, owner, snapshot.id, snapshot]);
  await db.query("select public.apply_blueprint_proposal($1,1,gen_random_uuid())", [proposal]);
  await db.query("select public.record_progress_evidence($1,2,'Pre-status existing outcome',null,gen_random_uuid())", [node.id]);
  return captureStatusUpgrade();
}

async function verifyStatusUpgrade(before) {
  assert.deepEqual(await captureStatusUpgrade(), before, "status migration preserves existing accounts, planning metadata and exact formal histories");
  const owner = "d9000000-0000-4000-8000-000000000101";
  const node = "d9000000-0000-4000-8000-000000000130";
  const mutation = "d9000000-0000-4000-8000-000000000170";
  await becomeUser(owner);
  const workspace = (await db.query("select public.read_node_status_workspace($1) as value", [owner])).rows[0].value;
  assert.equal(workspace.blueprint.schemaVersion, 2, "status does not introduce a new Blueprint format");
  assert.deepEqual(workspace.current, [], "existing nodes have no fabricated status records after upgrade");
  assert.deepEqual(workspace.history, []);
  const confirmation = (await db.query("select public.confirm_node_status($1,2,0,'completed',null,$2) as value", [node, mutation])).rows[0].value;
  assert.equal(confirmation.revision, 1);
  assert.equal(confirmation.estimated_minutes, 90);
  assert.equal(confirmation.completion_criteria, "Explain the result and its limits");
  assert.equal(confirmation.blueprint_version, 2);
  assert.deepEqual((await db.query("select public.confirm_node_status($1,2,0,'completed',null,$2) as value", [node, mutation])).rows[0].value, confirmation,
    "the generated status migration preserves exact public mutation receipts");
  const after = (await db.query("select public.read_node_status_workspace($1) as value", [owner])).rows[0].value;
  assert.deepEqual(after.blueprint, workspace.blueprint, "explicit status cannot revise the existing Blueprint");
  assert.deepEqual(after.current, [confirmation]);
  assert.deepEqual(after.history, [confirmation]);
  await assert.rejects(() => db.query("update public.node_status_confirmations set status='not_started'"), /permission denied/);
  const acl = (await db.query(`select
    has_table_privilege('anon','public.node_status_confirmations','SELECT') as anon_read,
    has_table_privilege('authenticated','private.node_status_mutations','SELECT') as ledger_read,
    has_function_privilege('anon','public.confirm_node_status(uuid,integer,integer,text,uuid,uuid)','EXECUTE') as anon_write,
    has_function_privilege('anon','public.read_node_status_workspace(uuid)','EXECUTE') as anon_workspace`)).rows[0];
  assert.deepEqual(acl, { anon_read: false, ledger_read: false, anon_write: false, anon_workspace: false }, "status migration retains explicit narrow ACLs");
  assert.deepEqual(await captureStatusUpgrade(), before, "status confirmation leaves all prior business rows and histories unchanged");
}

async function seedClarificationUpgrade() {
  const owner = "d9000000-0000-4000-8000-000000000101";
  const brief = "d9000000-0000-4000-8000-000000000180";
  const run = "d9000000-0000-4000-8000-000000000181";
  await becomeUser(owner);
  await db.query("select public.save_goal_brief($1,0,$2,true,gen_random_uuid())", [brief, {
    schemaVersion: 1, outcome: "Preserve planning source", startingPoint: "Existing experience", weeklyMinutes: 180,
    targetDate: null, constraints: "", successCriteria: "Explain one completed result",
  }]);
  await db.exec("reset role");
  await db.query("insert into private.path_planning_quotas(owner_id,available_attempts) values($1,1)", [owner]);
  await becomeUser(owner);
  await db.query("select public.begin_path_planning($1,$2,1,2,current_date)", [run, brief]);
  await db.exec("set role service_role");
  await db.query(`select public.claim_path_planning($1,$2,$2,jsonb_build_object(
    'name','blueprint-plan-path','version','1.0.0','instructions','Preserved fixed Skill',
    'sha256',encode(sha256(convert_to('Preserved fixed Skill','UTF8')),'hex')))`, [owner, run]);
  await db.exec("reset role");
  const tables = (await db.query(`select table_schema,table_name from information_schema.tables
    where table_schema in ('public','private') and table_type='BASE TABLE' order by table_schema,table_name`)).rows;
  const before = {};
  for (const { table_schema: schema, table_name: table } of tables) {
    before[`${schema}.${table}`] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${schema}"."${table}" t`)).rows[0].rows;
  }
  return before;
}

async function verifyClarificationUpgrade(before) {
  await db.exec("reset role");
  for (const [table, rows] of Object.entries(before)) {
    const [schema, name] = table.split(".");
    assert.deepEqual((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${schema}"."${name}" t`)).rows[0].rows,
      rows, `clarification migration preserves exact existing ${table} rows`);
  }
  for (const table of ["public.goal_clarification_sessions", "public.goal_clarification_turns", "private.goal_clarification_quotas"]) {
    assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0,
      "clarification upgrade fabricates neither model history nor free allowance");
  }
  const acl = (await db.query(`select
    has_function_privilege('anon','public.create_goal_clarification(uuid,uuid,integer)','EXECUTE') as anon_create,
    has_function_privilege('authenticated','public.claim_goal_clarification(uuid,uuid,uuid,jsonb)','EXECUTE') as user_claim,
    has_table_privilege('service_role','public.goal_clarification_turns','UPDATE') as admin_direct_write,
    has_table_privilege('authenticated','private.goal_clarification_leases','SELECT') as user_lease,
    has_table_privilege('service_role','private.goal_clarification_quotas','DELETE') as quota_delete`)).rows[0];
  assert.deepEqual(acl, { anon_create: false, user_claim: false, admin_direct_write: false, user_lease: false, quota_delete: false },
    "clarification migration retains narrow explicit execution and quota privileges");
}

async function captureResourceUpgrade() {
  await db.exec("reset role");
  const tables = (await db.query(`select table_schema,table_name from information_schema.tables
    where table_schema in ('public','private') and table_type='BASE TABLE' order by table_schema,table_name`)).rows;
  const before = {};
  for (const { table_schema: schema, table_name: table } of tables) {
    before[`${schema}.${table}`] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${schema}"."${table}" t`)).rows[0].rows;
  }
  return before;
}

async function seedResourceClearingUpgrade() {
  const owner = "d8000000-0000-4000-8000-000000000001";
  await becomeUser(owner);
  await db.query(`select public.record_learning_note('d8000000-0000-4000-8000-000000000012',
    'd8000000-0000-4000-8000-000000000013',2,'Preserved private timestamp note',75,'d8000000-0000-4000-8000-000000000040')`);
  await db.exec("reset role");
  await db.query(`insert into public.resource_adoptions(id,owner_id,source_run_id,blueprint_id,blueprint_version,node_id,video_id,new_binding_id,status,result,expires_at)
    select 'd8000000-0000-4000-8000-000000000041',owner_id,id,blueprint_id,blueprint_version,node_id,'abcdefghijk',
      'd8000000-0000-4000-8000-000000000042','failed','{"status":"unavailable"}',expires_at from public.resource_runs where id='d8000000-0000-4000-8000-000000000020'`);
  await db.query(`insert into private.resource_adoption_leases values('d8000000-0000-4000-8000-000000000041',
    'd8000000-0000-4000-8000-000000000043',sha256(convert_to('{"status":"unavailable"}','UTF8')))`);
  await db.query("insert into private.resource_adoption_quotas values($1,4)", [owner]);
  return captureResourceUpgrade();
}

async function verifyResourceClearingUpgrade(before) {
  const expected = structuredClone(before);
  for (const table of ["public.resource_runs", "public.resource_adoptions"])
    expected[table] = expected[table].map(row => ({ ...row, cleared_at: null }));
  assert.deepEqual(await captureResourceUpgrade(), expected,
    "clearing upgrade adds only nullable markers: all existing source payloads, leases, quotas, proposals, revisions, bindings, sessions and notes remain exact");
  const acl = (await db.query(`select p.prosecdef,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as owner_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as worker_execute,
    has_table_privilege('authenticated','public.resource_runs','UPDATE') as direct_run_write,
    has_table_privilege('authenticated','public.resource_adoptions','UPDATE') as direct_adoption_write
    from pg_proc p where p.oid='public.clear_resource_evidence(uuid)'::regprocedure`)).rows[0];
  assert.deepEqual(acl, { prosecdef: false, owner_execute: true, anonymous_execute: false, worker_execute: false,
    direct_run_write: false, direct_adoption_write: false }, "clearing exposes only an authenticated invoker entry, not direct table mutation");
  await becomeUser("d8000000-0000-4000-8000-000000000001");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal('d8000000-0000-4000-8000-000000000030',0,'d8000000-0000-4000-8000-000000000030') as version")).rows[0].version), 1,
    "old applied proposal continues to recover its historical revision after clearing schema upgrade");
  assert.deepEqual(await captureResourceUpgrade(), expected, "historical replay does not clear or rewrite any upgraded row");
}

async function verifyLearningNotesUpgrade(before) {
  assert.deepEqual(await captureResourceUpgrade(), { ...before, "public.learning_notes": [] },
    "notes migration preserves every existing source, proposal, formal path, evidence, status and learning-session row; no fabricated notes");
  const acl = (await db.query(`select
    has_table_privilege('authenticated','public.learning_notes','SELECT') as owner_read,
    has_table_privilege('authenticated','public.learning_notes','INSERT') as direct_insert,
    has_table_privilege('authenticated','public.learning_notes','UPDATE') as direct_update,
    has_table_privilege('authenticated','public.learning_notes','DELETE') as direct_delete,
    has_function_privilege('anon','public.record_learning_note(uuid,uuid,bigint,text,integer,uuid)','EXECUTE') as anon_write,
    has_function_privilege('anon','public.read_learning_note_workspace(uuid)','EXECUTE') as anon_read,
    has_function_privilege('service_role','private.record_learning_note(uuid,uuid,bigint,text,integer,uuid)','EXECUTE') as service_write,
    (select relrowsecurity from pg_class where oid='public.learning_notes'::regclass) as rls`)).rows[0];
  assert.deepEqual(acl, { owner_read: true, direct_insert: false, direct_update: false, direct_delete: false,
    anon_write: false, anon_read: false, service_write: false, rls: true }, "notes upgrade exposes only owner reads and narrow explicit authenticated RPCs");
  await becomeUser("d8000000-0000-4000-8000-000000000001");
  const workspace = (await db.query("select public.read_learning_note_workspace($1) as value", ["d8000000-0000-4000-8000-000000000001"])).rows[0].value;
  assert.deepEqual(workspace.records, [], "existing populated accounts start with no manufactured notes");
  assert.equal(workspace.blueprint.version, 2, "coherent read retains previously confirmed Blueprint revision");
  await db.exec("reset role");
  assert.deepEqual(await captureResourceUpgrade(), { ...before, "public.learning_notes": [] }, "upgrade workspace read is non-mutating");
}

async function verifyLearningPositionsUpgrade(before) {
  const expected = { ...before, "public.learning_positions": [] };
  assert.deepEqual(await captureResourceUpgrade(), expected,
    "position upgrade preserves every populated formal, proposal, evidence, lease, quota, note and session row; no manufactured playback positions");
  const acl = (await db.query(`select
    has_table_privilege('authenticated','public.learning_positions','SELECT') as owner_read,
    has_table_privilege('authenticated','public.learning_positions','INSERT') as direct_insert,
    has_table_privilege('authenticated','public.learning_positions','UPDATE') as direct_update,
    has_table_privilege('authenticated','public.learning_positions','DELETE') as direct_delete,
    has_function_privilege('anon','public.record_learning_position(uuid,uuid,integer,integer,integer,uuid)','EXECUTE') as anon_write,
    has_function_privilege('anon','public.read_learning_position_workspace(uuid,uuid)','EXECUTE') as anon_read,
    has_function_privilege('service_role','private.record_learning_position(uuid,uuid,integer,integer,integer,uuid)','EXECUTE') as service_write,
    (select relrowsecurity from pg_class where oid='public.learning_positions'::regclass) as rls,
    (select prosecdef from pg_proc where oid='public.read_learning_position_workspace(uuid,uuid)'::regprocedure) as definer_read,
    (select provolatile::text from pg_proc where oid='public.read_learning_position_workspace(uuid,uuid)'::regprocedure) as read_volatility`)).rows[0];
  assert.deepEqual(acl, { owner_read: true, direct_insert: false, direct_update: false, direct_delete: false,
    anon_write: false, anon_read: false, service_write: false, rls: true, definer_read: false, read_volatility: "s" },
    "position upgrade exposes only owner reads and narrow authenticated writes with a stable invoker workspace");
  await becomeUser("d8000000-0000-4000-8000-000000000001");
  const workspace = (await db.query("select public.read_learning_position_workspace($1) as value", ["d8000000-0000-4000-8000-000000000001"])).rows[0].value;
  assert.deepEqual(workspace.records, [], "existing accounts start without fabricated positions");
  assert.equal(workspace.blueprint.version, 2, "position workspace retains previously confirmed revision");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal('d8000000-0000-4000-8000-000000000030',0,'d8000000-0000-4000-8000-000000000030') as version")).rows[0].version), 1,
    "historical approved proposal still recovers original revision after position upgrade");
  assert.deepEqual(await captureResourceUpgrade(), expected, "position workspace and historical replay mutate no upgraded data");
}

async function verifyResourceUpgrade(before) {
  await db.exec("reset role");
  for (const [table, rows] of Object.entries(before)) {
    const [schema, name] = table.split(".");
    assert.deepEqual((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${schema}"."${name}" t`)).rows[0].rows,
      rows, `resource migration preserves exact existing ${table} rows`);
  }
  for (const table of ["public.resource_runs", "private.resource_quotas", "private.resource_leases"]) {
    assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0,
      "resource upgrade fabricates neither provider history nor free allowance");
  }
  const acl = (await db.query(`select
    has_function_privilege('anon','public.begin_resource_run(jsonb)','EXECUTE') as anon_begin,
    has_function_privilege('authenticated','public.claim_resource_run(uuid,uuid,uuid,jsonb)','EXECUTE') as user_claim,
    has_table_privilege('service_role','public.resource_runs','UPDATE') as admin_direct_write,
    has_table_privilege('authenticated','private.resource_leases','SELECT') as user_lease,
    has_table_privilege('service_role','private.resource_quotas','DELETE') as quota_delete`)).rows[0];
  assert.deepEqual(acl, { anon_begin: false, user_claim: false, admin_direct_write: false, user_lease: false, quota_delete: false },
    "resource migration retains narrow explicit execution and quota privileges");
}

async function seedAdoptionUpgrade() {
  await db.exec("reset role");
  const owner = "d8000000-0000-4000-8000-000000000001";
  const node = "d8000000-0000-4000-8000-000000000012";
  const binding = "d8000000-0000-4000-8000-000000000013";
  await db.query("insert into auth.users(id,email) values($1,'adoption-upgrade@example.test')", [owner]);
  await db.query(`insert into public.goals(id,owner_id,blueprint_id,title,position)
    select 'd8000000-0000-4000-8000-000000000010',owner_id,id,'Preserved goal',0 from public.blueprints where owner_id=$1`, [owner]);
  await db.query(`insert into public.stages(id,owner_id,goal_id,title,position)
    values('d8000000-0000-4000-8000-000000000011',$1,'d8000000-0000-4000-8000-000000000010','Preserved stage',0)`, [owner]);
  await db.query(`insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position)
    values($2,$1,'d8000000-0000-4000-8000-000000000011','learn','Preserved node',0)`, [owner, node]);
  await db.query(`insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
    values($3,$1,$2,'youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk',0)`, [owner, node, binding]);
  await becomeUser(owner);
  const snapshot = (await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value;
  await db.query(`insert into public.learning_sessions(owner_id,node_id,resource_binding_id,source,started_at,client_mutation_id)
    values($1,$2,$3,'extension',now(),gen_random_uuid())`, [owner, node, binding]);
  await db.query(`insert into public.blueprint_proposals(owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
    values($1,$2,0,$3,gen_random_uuid())`, [owner, snapshot.id, snapshot]);
  await db.exec("reset role");
  await db.query(`insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
    values('d8000000-0000-4000-8000-000000000020',$1,$2,0,$3,'discover','{}','{}',$4,'{"status":"discovered","candidates":[]}','ready',now()+interval '120 seconds')`, [owner, snapshot.id, node, snapshot]);
  return captureResourceUpgrade();
}

async function verifyAdoptionUpgrade(before) {
  assert.deepEqual(await captureResourceUpgrade(), {
    ...before,
    "public.resource_adoptions": [],
    "private.resource_adoption_quotas": [],
    "private.resource_adoption_leases": [],
  }, "adoption migration preserves exact pre-existing source, proposal, binding and learning-session rows without fabricating allowance");
  const acl = (await db.query(`select
    has_function_privilege('anon','public.begin_resource_adoption(jsonb)','EXECUTE') as anon_begin,
    has_function_privilege('authenticated','public.claim_resource_adoption(uuid,uuid,uuid)','EXECUTE') as user_claim,
    has_function_privilege('authenticated','private.apply_blueprint_proposal_pre_adoption(uuid,bigint,uuid)','EXECUTE') as old_guard,
    has_table_privilege('service_role','public.resource_adoptions','UPDATE') as direct_update,
    has_table_privilege('authenticated','private.resource_adoption_leases','SELECT') as private_lease,
    has_table_privilege('service_role','private.resource_adoption_quotas','DELETE') as quota_delete`)).rows[0];
  assert.deepEqual(acl, { anon_begin: false, user_claim: false, old_guard: false, direct_update: false, private_lease: false, quota_delete: false },
    "adoption migration preserves narrow grants and cannot expose legacy apply bypass");
  await becomeUser("d9000000-0000-4000-8000-000000000101");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000140',0,'d9000000-0000-4000-8000-000000000160') as version")).rows[0].version), 1,
    "new adoption guard retains exact historical manual apply receipt");
  await db.exec("reset role");
}

async function seedResourceOrderUpgrade() {
  const owner = "d8000000-0000-4000-8000-000000000001";
  const oldProposal = "d8000000-0000-4000-8000-000000000030";
  const pending = "d8000000-0000-4000-8000-000000000031";
  await becomeUser(owner);
  const draft = (await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value;
  draft.goals[0].stages[0].nodes[0].resources.unshift({
    id: "d8000000-0000-4000-8000-000000000014", kind: "youtube_video",
    url: "https://www.youtube.com/watch?v=zzzzzzzzzzz", externalId: "zzzzzzzzzzz",
  });
  await db.query(`insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
    values($1,$2,$3,0,$4,$1)`, [oldProposal, owner, draft.id, draft]);
  await db.query("select public.apply_blueprint_proposal($1,0,$1)", [oldProposal]);
  const current = (await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value;
  assert.equal(current.goals[0].stages[0].nodes[0].resources[0].externalId, "abcdefghijk",
    "upgrade fixture preserves the pre-fix UUID order rather than hiding the existing defect");
  draft.version = 1;
  await db.query(`insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
    values($1,$2,$3,1,$4,$1)`, [pending, owner, draft.id, draft]);
  return { owner, oldProposal, pending, draft, before: await captureResourceUpgrade() };
}

async function verifyResourceOrderUpgrade({ owner, oldProposal, pending, draft, before }) {
  assert.deepEqual(await captureResourceUpgrade(), before,
    "ordering upgrade is forward-only: all existing formal positions, sessions, sources, proposals and revisions remain byte-for-byte unchanged");
  await becomeUser(owner);
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal($1,0,$1) as version", [oldProposal])).rows[0].version), 1,
    "old exact confirmation still recovers its historical receipt");
  assert.deepEqual(await captureResourceUpgrade(), before, "historical replay never silently backfills old order");
  await becomeUser(owner);
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal($1,1,$1) as version", [pending])).rows[0].version), 2,
    "only a future explicit confirmation persists intended order");
  const expected = structuredClone(draft);
  expected.version = 2;
  assert.deepEqual((await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value, expected,
    "post-upgrade public read equals confirmed resource array order");
  assert.deepEqual((await db.query("select snapshot from public.blueprint_revisions where proposal_id=$1", [pending])).rows[0].snapshot, expected,
    "post-upgrade revision equals formal order");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal($1,0,$1) as version", [oldProposal])).rows[0].version), 1);
  assert.deepEqual((await db.query("select public.read_blueprint_snapshot_v2($1) as value", [owner])).rows[0].value, expected,
    "historical replay after newer confirmation does not revert order");
  await db.exec("reset role");
  const after = await captureResourceUpgrade();
  assert.deepEqual(after["public.learning_sessions"], before["public.learning_sessions"], "future reorder preserves all learning attribution");
  const acl = (await db.query(`select p.prosecdef,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as user_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p where p.oid='private.apply_blueprint_proposal_core(uuid,bigint,uuid)'::regprocedure`)).rows[0];
  assert.deepEqual(acl, { prosecdef: false, user_execute: false, service_execute: false, anon_execute: false },
    "shared writer remains invoker-only and inaccessible outside existing guards");
}
