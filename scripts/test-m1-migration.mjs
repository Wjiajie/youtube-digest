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
  let avatarMigrationSeen = false;
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
    const expiryUpgrade = file.endsWith("_resource_evidence_expiry.sql") ? await captureResourceUpgrade() : null;
    const avatarUpgrade = file.endsWith("_avatar_runs.sql") ? await captureResourceUpgrade() : null;
    if (avatarUpgrade) avatarMigrationSeen = true;
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
    if (expiryUpgrade) await verifyResourceExpiryUpgrade(expiryUpgrade);
    if (avatarUpgrade) await verifyAvatarUpgrade(avatarUpgrade);
  }
  // Fail closed: the avatar data layer contract is meaningless if its migration is absent.
  assert.ok(avatarMigrationSeen, "avatar_runs migration must be applied by the ordered migration sweep");
  await verifyAvatarLifecycle();
  await verifyAvatarOutcomes();
  await verifyAvatarDbGuards();
  await verifyAvatarExpiry();
  await verifyAvatarAccessGuards();
  console.log("Avatar contract passed: single-flight, debit-once, failure completion, lease fencing and the storage guard.");
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

async function verifyResourceExpiryUpgrade(before) {
  const expected = structuredClone(before);
  for (const table of ["public.resource_runs", "public.resource_adoptions"])
    expected[table] = expected[table].map(row => ({ ...row, source_started_at: null,
      content_expires_at: null, retention_policy_ref: null, clear_reason: null }));
  expected["private.resource_retention_policies"] = [];
  assert.deepEqual(await captureResourceUpgrade(), expected,
    "expiry upgrade preserves every legacy payload, receipt, lease, quota, formal history and learning record; no invented policy or timestamp");
  const acl = (await db.query(`select
    has_function_privilege('authenticated','private.sweep_resource_content(integer)','EXECUTE') as user_sweep,
    has_function_privilege('service_role','private.sweep_resource_content(integer)','EXECUTE') as worker_sweep,
    has_function_privilege('anon','private.sweep_resource_content(integer)','EXECUTE') as anon_sweep,
    has_function_privilege('authenticated','private.clear_resource_chain(uuid,uuid,text)','EXECUTE') as user_core,
    has_table_privilege('authenticated','private.resource_retention_policies','SELECT') as policy_read,
    has_table_privilege('service_role','private.resource_retention_policies','UPDATE') as worker_policy`)).rows[0];
  assert.deepEqual(acl, { user_sweep: false, worker_sweep: false, anon_sweep: false,
    user_core: false, policy_read: false, worker_policy: false }, "expiry maintenance and policy are not exposed to API roles");
  await becomeUser("d8000000-0000-4000-8000-000000000001");
  await assert.rejects(() => db.query("select public.read_resource_run('d8000000-0000-4000-8000-000000000020')"),
    /RESOURCE_RETENTION_UNAVAILABLE/, "legacy definer read cannot return unmanaged body");
  assert.deepEqual((await db.query("select id from public.resource_runs")).rows, [], "legacy Data API read fails closed");
  assert.equal(Number((await db.query("select public.apply_blueprint_proposal('d8000000-0000-4000-8000-000000000030',0,'d8000000-0000-4000-8000-000000000030') as version")).rows[0].version), 1,
    "historical applied proposal still recovers its immutable version");
  assert.deepEqual(await captureResourceUpgrade(), expected, "failed legacy read and old applied retry erase or rewrite no rows");
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

async function verifyAvatarUpgrade(before) {
  await db.exec("reset role");
  for (const [table, rows] of Object.entries(before)) {
    const [schema, name] = table.split(".");
    assert.deepEqual((await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${schema}"."${name}" t`)).rows[0].rows,
      rows, `avatar migration preserves exact existing ${table} rows`);
  }
  for (const table of ["public.avatar_runs", "private.avatar_quotas", "private.avatar_leases"]) {
    assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0,
      "avatar upgrade fabricates neither generation history nor free allowance");
  }
  const shape = (await db.query(`select
    (select count(*)::int from pg_policy where polrelid='public.avatar_runs'::regclass) as run_policies,
    (select count(*)::int from pg_policy where polrelid in ('private.avatar_quotas'::regclass,'private.avatar_leases'::regclass)) as private_policies,
    (select relrowsecurity from pg_class where oid='public.avatar_runs'::regclass) as run_rls,
    (select relrowsecurity from pg_class where oid='private.avatar_quotas'::regclass) as quota_rls,
    (select relrowsecurity from pg_class where oid='private.avatar_leases'::regclass) as lease_rls,
    (select count(*)::int from pg_index where indrelid='public.avatar_runs'::regclass and indisunique and indpred is not null) as partial_unique`)).rows[0];
  assert.deepEqual(shape, { run_policies: 1, private_policies: 0, run_rls: true, quota_rls: true, lease_rls: true, partial_unique: 1 },
    "avatar runs expose exactly one owner read policy, no private policy leak and one partial unique single-flight index");

  const acl = (await db.query(`select
    has_table_privilege('authenticated','public.avatar_runs','SELECT') as user_select,
    has_table_privilege('authenticated','public.avatar_runs','INSERT') as user_insert,
    has_table_privilege('authenticated','public.avatar_runs','UPDATE') as user_update,
    has_table_privilege('authenticated','public.avatar_runs','DELETE') as user_delete,
    has_table_privilege('service_role','public.avatar_runs','UPDATE') as admin_direct_write,
    has_table_privilege('anon','public.avatar_runs','SELECT') as anon_select,
    has_table_privilege('authenticated','private.avatar_quotas','SELECT') as user_quota_read,
    has_table_privilege('authenticated','private.avatar_leases','SELECT') as user_lease,
    has_table_privilege('service_role','private.avatar_quotas','SELECT') as admin_quota_read,
    has_table_privilege('service_role','private.avatar_quotas','DELETE') as quota_delete,
    has_table_privilege('service_role','private.avatar_quotas','TRUNCATE') as quota_truncate,
    has_table_privilege('service_role','private.avatar_leases','SELECT') as admin_lease_read,
    has_function_privilege('anon','public.begin_avatar_run(jsonb)','EXECUTE') as anon_begin,
    has_function_privilege('authenticated','public.begin_avatar_run(jsonb)','EXECUTE') as user_begin,
    has_function_privilege('authenticated','public.claim_avatar_run(uuid,uuid,uuid)','EXECUTE') as user_claim,
    has_function_privilege('service_role','public.claim_avatar_run(uuid,uuid,uuid)','EXECUTE') as admin_claim,
    has_function_privilege('service_role','public.finish_avatar_run(uuid,uuid,uuid,jsonb)','EXECUTE') as admin_finish,
    has_function_privilege('authenticated','public.finish_avatar_run(uuid,uuid,uuid,jsonb)','EXECUTE') as user_finish`)).rows[0];
  assert.deepEqual(acl, {
    user_select: true, user_insert: false, user_update: false, user_delete: false,
    admin_direct_write: false, anon_select: false,
    user_quota_read: false, user_lease: false,
    admin_quota_read: true, quota_delete: false, quota_truncate: false, admin_lease_read: false,
    anon_begin: false, user_begin: true, user_claim: false, admin_claim: true, admin_finish: true, user_finish: false,
  }, "avatar migration retains narrow explicit table and execution privileges");

  const functions = (await db.query(`select
    has_function_privilege('authenticated','private.begin_avatar_run(jsonb)','EXECUTE') as pv_user_begin,
    has_function_privilege('service_role','private.begin_avatar_run(jsonb)','EXECUTE') as pv_admin_begin,
    has_function_privilege('anon','private.begin_avatar_run(jsonb)','EXECUTE') as pv_anon_begin,
    has_function_privilege('authenticated','private.read_avatar_run(uuid)','EXECUTE') as pv_user_read,
    has_function_privilege('authenticated','private.cancel_avatar_run(uuid)','EXECUTE') as pv_user_cancel,
    has_function_privilege('authenticated','private.claim_avatar_run(uuid,uuid,uuid)','EXECUTE') as pv_user_claim,
    has_function_privilege('service_role','private.claim_avatar_run(uuid,uuid,uuid)','EXECUTE') as pv_admin_claim,
    has_function_privilege('authenticated','private.finish_avatar_run(uuid,uuid,uuid,jsonb)','EXECUTE') as pv_user_finish,
    has_function_privilege('service_role','private.finish_avatar_run(uuid,uuid,uuid,jsonb)','EXECUTE') as pv_admin_finish,
    has_function_privilege('authenticated','public.read_avatar_run(uuid)','EXECUTE') as pub_user_read,
    has_function_privilege('authenticated','public.cancel_avatar_run(uuid)','EXECUTE') as pub_user_cancel,
    has_function_privilege('service_role','public.read_avatar_run(uuid)','EXECUTE') as pub_admin_read,
    has_function_privilege('service_role','public.begin_avatar_run(jsonb)','EXECUTE') as pub_admin_begin,
    has_function_privilege('authenticated','public.claim_avatar_run(uuid,uuid,uuid)','EXECUTE') as pub_user_claim,
    has_function_privilege('authenticated','private.avatar_web_actor()','EXECUTE') as pv_user_actor,
    has_function_privilege('service_role','private.avatar_expire_runs(uuid)','EXECUTE') as pv_admin_expire,
    has_function_privilege('service_role','private.avatar_request_valid(jsonb)','EXECUTE') as pv_admin_req,
    has_function_privilege('service_role','private.avatar_result_valid(public.avatar_runs,jsonb)','EXECUTE') as pv_admin_res,
    (select count(*)::int from pg_policy where polrelid='public.avatar_runs'::regclass and polname='avatar_web_owner_read'
      and polcmd='r' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
      and pg_get_expr(polqual,polrelid) ilike '%owner_id%'
      and pg_get_expr(polqual,polrelid) ilike '%is_extension_client%'
      and pg_get_expr(polqual,polrelid) ilike '%is_anonymous%') as owner_policy_shape,
    (select count(*)::int from pg_index where indrelid='public.avatar_runs'::regclass and indisunique and indpred is not null) as partial_unique
    `)).rows[0];
  assert.deepEqual(functions, {
    pv_user_begin: true, pv_admin_begin: false, pv_anon_begin: false,
    pv_user_read: true, pv_user_cancel: true,
    pv_user_claim: false, pv_admin_claim: true, pv_user_finish: false, pv_admin_finish: true,
    pub_user_read: true, pub_user_cancel: true, pub_admin_read: false, pub_admin_begin: false, pub_user_claim: false,
    pv_user_actor: false, pv_admin_expire: false, pv_admin_req: false, pv_admin_res: false,
    owner_policy_shape: 1, partial_unique: 1,
  }, "avatar migration asserts the §6.3 execution matrix on both namespaces and the §6.2 owner policy shape");

  const definers = (await db.query(`select
    (select prosecdef from pg_proc where oid='private.begin_avatar_run(jsonb)'::regprocedure) as pb,
    (select prosecdef from pg_proc where oid='public.begin_avatar_run(jsonb)'::regprocedure) as ub,
    (select prosecdef from pg_proc where oid='private.read_avatar_run(uuid)'::regprocedure) as pr,
    (select prosecdef from pg_proc where oid='public.read_avatar_run(uuid)'::regprocedure) as ur,
    (select prosecdef from pg_proc where oid='private.cancel_avatar_run(uuid)'::regprocedure) as pc,
    (select prosecdef from pg_proc where oid='public.cancel_avatar_run(uuid)'::regprocedure) as uc,
    (select prosecdef from pg_proc where oid='private.claim_avatar_run(uuid,uuid,uuid)'::regprocedure) as pl,
    (select prosecdef from pg_proc where oid='public.claim_avatar_run(uuid,uuid,uuid)'::regprocedure) as ul,
    (select prosecdef from pg_proc where oid='private.finish_avatar_run(uuid,uuid,uuid,jsonb)'::regprocedure) as pf,
    (select prosecdef from pg_proc where oid='public.finish_avatar_run(uuid,uuid,uuid,jsonb)'::regprocedure) as uf`)).rows[0];
  assert.deepEqual(definers, { pb: true, ub: false, pr: true, ur: false, pc: true, uc: false, pl: true, ul: false, pf: true, uf: false },
    "all five avatar entrypoints keep the private-definer / public-invoker split");
}

// Behavioural probe for the parts a migration-time snapshot cannot reach: the real
// run lifecycle over the real functions, including a legitimate provider failure.
async function verifyAvatarLifecycle() {
  await db.exec("reset role");
  const owner = "aa000000-0000-4000-8000-000000000001";
  const other = "aa000000-0000-4000-8000-000000000002";
  const runId = "aa000000-0000-4000-8000-000000000020";
  const secondRun = "aa000000-0000-4000-8000-000000000021";
  const lease = "aa000000-0000-4000-8000-000000000030";
  const request = { runId, kind: "generate", themeId: "cyberpunk", themeVersion: 1 };
  await db.query("insert into auth.users(id,email) values($1,'avatar-owner@example.test'),($2,'avatar-other@example.test')", [owner, other]);
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',2)", [owner]);

  // An account with no quota row gets no implicit free call, and a rejected begin is inert.
  await becomeUser(other);
  await assert.rejects(() => db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify(request)]),
    /AVATAR_QUOTA_EXHAUSTED/, "an account without a quota row cannot start a run");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs where owner_id=$1", [other])).rows[0].count, 0,
    "a quota-rejected begin leaves no run and no allowance row");

  // Reserve once, then replay: same row, one debit.
  await becomeUser(owner);
  const first = (await db.query("select public.begin_avatar_run($1::jsonb) as run", [JSON.stringify(request)])).rows[0].run;
  assert.equal(first.status, "queued", "begin reserves a queued run");
  const replay = (await db.query("select public.begin_avatar_run($1::jsonb) as run", [JSON.stringify(request)])).rows[0].run;
  assert.deepEqual(replay, first, "an exact replay returns the stored run");
  await db.exec("reset role");
  assert.equal((await db.query("select available_attempts from private.avatar_quotas where owner_id=$1 and kind='generate'", [owner])).rows[0].available_attempts, 1,
    "an exact replay debits exactly once");

  // A second distinct run is refused while one is active, without debiting.
  await becomeUser(owner);
  await assert.rejects(() => db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ ...request, runId: secondRun })]),
    /AVATAR_BUSY/, "a second active run is refused");
  await db.exec("reset role");
  assert.equal((await db.query("select available_attempts from private.avatar_quotas where owner_id=$1 and kind='generate'", [owner])).rows[0].available_attempts, 1,
    "the busy rejection debits nothing");

  // Claim, then record a legitimate provider failure.
  await db.exec("set role service_role");
  assert.equal((await db.query("select public.claim_avatar_run($1,$2,$3) as claim", [owner, runId, lease])).rows[0].claim.acquired, true,
    "the first claim acquires execution");
  assert.equal((await db.query("select public.claim_avatar_run($1,$2,$3) as claim", [owner, runId, lease])).rows[0].claim.acquired, false,
    "a second claim is refused");
  const failed = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run",
    [owner, runId, lease, JSON.stringify({ status: "unavailable" })])).rows[0].run;
  assert.equal(failed.status, "failed", "a valid failure receipt completes the run as failed");
  assert.deepEqual(failed.result, { status: "unavailable" }, "the failure result is persisted verbatim");
  await db.exec("reset role");
  assert.ok((await db.query("select completion_digest from private.avatar_leases where run_id=$1", [runId])).rows[0].completion_digest,
    "the failure receipt is fingerprinted on the lease");
  await db.exec("set role service_role");
  await assert.rejects(() => db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb)",
    [owner, runId, lease, JSON.stringify({ status: "unavailable", bytes: 1 })]),
    /AVATAR_COMPLETION_REUSED/, "the same lease cannot complete twice with a different result");
  const identical = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run",
    [owner, runId, lease, JSON.stringify({ status: "unavailable" })])).rows[0].run;
  assert.equal(identical.status, "failed", "an exact completion replay returns the identical row");
  await db.exec("reset role");
  assert.equal((await db.query("select status from public.avatar_runs where id=$1", [runId])).rows[0].status, "failed",
    "a refused completion never overwrites the recorded failure");

  // An unknown failure literal is still rejected, and the run keeps its execution right.
  await becomeUser(owner);
  await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ ...request, runId: secondRun })]);
  await db.exec("reset role");
  await db.exec("set role service_role");
  await db.query("select public.claim_avatar_run($1,$2,$3)", [owner, secondRun, lease]);
  await assert.rejects(() => db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb)",
    [owner, secondRun, lease, JSON.stringify({ status: "bogus" })]),
    /AVATAR_INVALID_RESULT/, "an unknown failure literal is rejected");
  await assert.rejects(() => db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb)",
    [owner, secondRun, lease, JSON.stringify({ status: "generated", objectPath: owner + "/" + secondRun + "/avatar.glb", mimeType: "model/gltf-binary", bytes: 0, sha256: "a".repeat(64) })]),
    /AVATAR_INVALID_RESULT/, "a zero-byte success receipt is rejected");
  await db.exec("reset role");
  assert.equal((await db.query("select completion_digest from private.avatar_leases where run_id=$1", [secondRun])).rows[0].completion_digest, null,
    "a rejected result leaves no completion digest and keeps the execution right");
  assert.equal((await db.query("select status from public.avatar_runs where id=$1", [secondRun])).rows[0].status, "running",
    "a rejected result leaves the run running for the true outcome");
  await db.exec("set role service_role");
  const recovered = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run",
    [owner, secondRun, lease, JSON.stringify({ status: "rate_limited" })])).rows[0].run;
  assert.equal(recovered.status, "failed", "a rejected result leaves the run claimable for the true outcome");
  await db.exec("reset role");

  // Cancelling a queued run refunds exactly once.
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',1) on conflict (owner_id,kind) do update set available_attempts=1", [owner]);
  await becomeUser(owner);
  await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ ...request, runId: "aa000000-0000-4000-8000-000000000022" })]);
  await db.query("select public.cancel_avatar_run($1)", ["aa000000-0000-4000-8000-000000000022"]);
  await db.query("select public.cancel_avatar_run($1)", ["aa000000-0000-4000-8000-000000000022"]);
  await db.exec("reset role");
  assert.equal((await db.query("select available_attempts from private.avatar_quotas where owner_id=$1 and kind='generate'", [owner])).rows[0].available_attempts, 1,
    "a repeated cancel refunds exactly once");

  // Cross-account isolation and cascade deletion.
  await becomeUser(other);
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs")).rows[0].count, 0, "another account sees no avatar runs");
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [owner]);
  const cascade = (await db.query(`select
    (select count(*)::int from public.avatar_runs where owner_id=$1) as runs,
    (select count(*)::int from private.avatar_quotas where owner_id=$1) as quotas,
    (select count(*)::int from private.avatar_leases l where not exists(select 1 from public.avatar_runs r where r.id=l.run_id)) as orphan_leases`, [owner])).rows[0];
  assert.deepEqual(cascade, { runs: 0, quotas: 0, orphan_leases: 0 }, "deleting the account cascades to runs, quotas and leases");
}

// T44/T46/T47: every failure literal is accepted, the byte bound is two-sided, and
// theme drift is the reachable trigger for the stale terminal state.
async function verifyAvatarOutcomes() {
  await db.exec("reset role");
  const owner = "ac000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users(id,email) values($1,'avatar-outcomes@example.test')", [owner]);
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',12)", [owner]);
  const request = (suffix) => ({ runId: "ac000000-0000-4000-8000-0000000000" + suffix, kind: "generate", themeId: "cyberpunk", themeVersion: 1 });
  const success = (runId, bytes) => JSON.stringify({ status: "generated", objectPath: owner + "/" + runId + "/avatar.glb",
    mimeType: "model/gltf-binary", bytes, sha256: "a".repeat(64) });
  async function reserve(runId) {
    await becomeUser(owner);
    await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ runId, kind: "generate", themeId: "cyberpunk", themeVersion: 1 })]);
    await db.exec("reset role");
  }
  async function lease(runId, leaseId) {
    await db.exec("set role service_role");
    await db.query("select public.claim_avatar_run($1,$2,$3)", [owner, runId, leaseId]);
    await db.exec("reset role");
  }

  const literals = ["invalid_input", "not_applicable", "unavailable", "rate_limited", "cancelled", "timed_out", "not_found", "invalid_output"];
  for (const [index, literal] of literals.entries()) {
    const runId = "ac000000-0000-4000-8000-0000000000" + String(20 + index);
    const leaseId = "ac000000-0000-4000-8000-0000000001" + String(index).padStart(2, "0");
    await reserve(runId);
    await lease(runId, leaseId);
    await db.exec("set role service_role");
    const done = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run", [owner, runId, leaseId, JSON.stringify({ status: literal })])).rows[0].run;
    await db.exec("reset role");
    assert.equal(done.status, literal === "cancelled" ? "cancelled" : "failed", "failure literal " + literal + " completes the run");
    assert.deepEqual(done.result, { status: literal }, "failure literal " + literal + " is persisted verbatim");
  }

  const boundRun = "ac000000-0000-4000-8000-000000000041";
  const boundLease = "ac000000-0000-4000-8000-000000000141";
  await reserve(boundRun);
  await lease(boundRun, boundLease);
  await db.exec("set role service_role");
  await assert.rejects(() => db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb)", [owner, boundRun, boundLease, success(boundRun, 10485761)]),
    /AVATAR_INVALID_RESULT/, "one byte over the cap is rejected");
  const atCap = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run", [owner, boundRun, boundLease, success(boundRun, 10485760)])).rows[0].run;
  await db.exec("reset role");
  assert.equal(atCap.status, "ready", "the exact byte cap is accepted");

  const staleRun = "ac000000-0000-4000-8000-000000000042";
  const staleLease = "ac000000-0000-4000-8000-000000000142";
  await reserve(staleRun);
  await lease(staleRun, staleLease);
  await db.query("update public.profiles set theme_version=2 where id=$1", [owner]);
  await db.exec("set role service_role");
  const stale = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run", [owner, staleRun, staleLease, success(staleRun, 1024)])).rows[0].run;
  await db.exec("reset role");
  assert.equal(stale.status, "stale", "a run completing after theme drift is stale, not ready");

  await db.query("update public.profiles set theme_version=1 where id=$1", [owner]);
  const readyRun = "ac000000-0000-4000-8000-000000000043";
  const readyLease = "ac000000-0000-4000-8000-000000000143";
  await reserve(readyRun);
  await lease(readyRun, readyLease);
  await db.exec("set role service_role");
  const ready = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run", [owner, readyRun, readyLease, success(readyRun, 1024)])).rows[0].run;
  await db.exec("reset role");
  assert.equal(ready.status, "ready", "an unchanged theme completes as ready");
  await db.query("update public.profiles set theme_version=2 where id=$1", [owner]);
  await becomeUser(owner);
  const flipped = (await db.query("select public.read_avatar_run($1) as run", [readyRun])).rows[0].run;
  await db.exec("reset role");
  assert.equal(flipped.status, "stale", "the expiry sweep flips a ready run to stale after theme drift");
}

// T15/T16/T23: the guards that must hold in the database itself.
async function verifyAvatarDbGuards() {
  await db.exec("reset role");
  const owner = "ad000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users(id,email) values($1,'avatar-guards@example.test')", [owner]);
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',4)", [owner]);
  const runId = "ad000000-0000-4000-8000-000000000020";
  const base = { runId, kind: "generate", themeId: "cyberpunk", themeVersion: 1 };

  // T15: the status vocabulary is closed at the database level. Assert on the real
  // message text: assert.rejects matches the message, not the SQLSTATE.
  await assert.rejects(() => db.query("insert into public.avatar_runs(id,owner_id,kind,theme_id,theme_version,status,expires_at) values($1,$2,'generate','cyberpunk',1,'unknown',clock_timestamp()+interval '600 seconds')",
    ["ad000000-0000-4000-8000-000000000099", owner]),
    /violates check constraint/, "an unknown status is refused by the check constraint");
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs where owner_id=$1", [owner])).rows[0].count, 0,
    "the refused status insert leaves no row");

  // T16: five malformed requests, none of which may create a row or debit.
  await becomeUser(owner);
  const invalid = [
    { ...base, kind: "mesh" },
    { ...base, themeId: "Neon" },
    { ...base, themeVersion: 0 },
    { ...base, extra: 1 },
    (() => { const { themeVersion, ...rest } = base; return rest; })(),
  ];
  for (const payload of invalid) {
    await assert.rejects(() => db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify(payload)]),
      /AVATAR_INVALID/, "malformed request refused: " + JSON.stringify(payload));
  }
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs where owner_id=$1", [owner])).rows[0].count, 0,
    "every malformed request is inert");
  assert.equal((await db.query("select available_attempts from private.avatar_quotas where owner_id=$1", [owner])).rows[0].available_attempts, 4,
    "malformed requests debit nothing");

  // T23: the partial unique index arbitrates single-flight, not application code.
  await becomeUser(owner);
  await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify(base)]);
  await db.exec("reset role");
  await assert.rejects(() => db.query("insert into public.avatar_runs(id,owner_id,kind,theme_id,theme_version,status,expires_at) values($1,$2,'generate','cyberpunk',1,'queued',clock_timestamp()+interval '600 seconds')",
    ["ad000000-0000-4000-8000-000000000021", owner]),
    /duplicate key/, "a second active run is refused by the partial unique index");
}

// T31/T32/T33: expiry refunds only an unclaimed run, and a late receipt never revives.
async function verifyAvatarExpiry() {
  await db.exec("reset role");
  const owner = "ae000000-0000-4000-8000-000000000001";
  await db.query("insert into auth.users(id,email) values($1,'avatar-expiry@example.test')", [owner]);
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',3)", [owner]);
  const queuedRun = "ae000000-0000-4000-8000-000000000020";
  const claimedRun = "ae000000-0000-4000-8000-000000000021";
  const claimedLease = "ae000000-0000-4000-8000-000000000030";
  async function reserve(runId) {
    await becomeUser(owner);
    await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ runId, kind: "generate", themeId: "cyberpunk", themeVersion: 1 })]);
    await db.exec("reset role");
  }
  const quota = async () => (await db.query("select available_attempts from private.avatar_quotas where owner_id=$1", [owner])).rows[0].available_attempts;

  // T31: an expired queued run is cancelled and refunded exactly once.
  await reserve(queuedRun);
  await db.query("update public.avatar_runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [queuedRun]);
  await becomeUser(owner);
  const first = (await db.query("select public.read_avatar_run($1) as run", [queuedRun])).rows[0].run;
  const second = (await db.query("select public.read_avatar_run($1) as run", [queuedRun])).rows[0].run;
  await db.exec("reset role");
  assert.equal(first.status, "cancelled", "an expired queued run becomes cancelled");
  assert.deepEqual(second.result, { status: "cancelled" }, "the cancelled result is stable across repeated reads");
  assert.equal(await quota(), 3, "an expired queued run is refunded exactly once");

  // T32: an expired claimed run is interrupted and never refunded.
  await reserve(claimedRun);
  await db.exec("set role service_role");
  await db.query("select public.claim_avatar_run($1,$2,$3)", [owner, claimedRun, claimedLease]);
  await db.exec("reset role");
  await db.query("update public.avatar_runs set expires_at=clock_timestamp()-interval '1 second' where id=$1", [claimedRun]);
  await becomeUser(owner);
  const interrupted = (await db.query("select public.read_avatar_run($1) as run", [claimedRun])).rows[0].run;
  await db.exec("reset role");
  assert.equal(interrupted.status, "interrupted", "an expired claimed run is interrupted");
  assert.deepEqual(interrupted.result, { status: "timed_out" }, "claimed expiry records a timeout");
  assert.equal(await quota(), 2, "claimed expiry refunds nothing");

  // T33: a late success receipt is fingerprinted but never revives the run.
  await db.exec("set role service_role");
  const late = (await db.query("select public.finish_avatar_run($1,$2,$3,$4::jsonb) as run", [owner, claimedRun, claimedLease,
    JSON.stringify({ status: "generated", objectPath: owner + "/" + claimedRun + "/avatar.glb", mimeType: "model/gltf-binary", bytes: 2048, sha256: "b".repeat(64) })])).rows[0].run;
  await db.exec("reset role");
  assert.equal(late.status, "interrupted", "a late success receipt does not revive the run");
  assert.ok((await db.query("select completion_digest from private.avatar_leases where run_id=$1", [claimedRun])).rows[0].completion_digest,
    "the late receipt is still fingerprinted on the lease");
  assert.equal((await db.query("select lease_id from private.avatar_leases where run_id=$1", [claimedRun])).rows[0].lease_id, claimedLease,
    "expiry never deletes or rewrites the lease");
}

// §6.4 + runtime T18: the tenant boundary is behavioural, not just introspective.
async function verifyAvatarAccessGuards() {
  await db.exec("reset role");
  const owner = "af000000-0000-4000-8000-000000000001";
  const other = "af000000-0000-4000-8000-000000000002";
  const runId = "af000000-0000-4000-8000-000000000020";
  await db.query("insert into auth.users(id,email) values($1,'avatar-access@example.test'),($2,'avatar-outsider@example.test')", [owner, other]);
  await db.query("insert into private.avatar_quotas(owner_id,kind,available_attempts) values($1,'generate',1)", [owner]);
  await becomeUser(owner);
  await db.query("select public.begin_avatar_run($1::jsonb)", [JSON.stringify({ runId, kind: "generate", themeId: "cyberpunk", themeVersion: 1 })]);
  await db.exec("reset role");

  async function asCaller(userId, claims) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  }

  await asCaller(owner, { sub: owner, role: "authenticated", client_id: "extension" });
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs")).rows[0].count, 0, "an extension client reads no avatar runs");
  await assert.rejects(() => db.query("select public.read_avatar_run($1)", [runId]), /AVATAR_FORBIDDEN/, "an extension client cannot read its own run");

  await asCaller(owner, { sub: owner, role: "authenticated", is_anonymous: true });
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs")).rows[0].count, 0, "an anonymous session reads no avatar runs");
  await assert.rejects(() => db.query("select public.read_avatar_run($1)", [runId]), /AVATAR_FORBIDDEN/, "an anonymous session is refused");

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  await assert.rejects(() => db.query("select public.read_avatar_run($1)", [runId]), /AVATAR_FORBIDDEN/, "an unauthenticated caller is refused");

  await asCaller(other, { sub: other, role: "authenticated" });
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs")).rows[0].count, 0, "another account reads no avatar runs");
  await assert.rejects(() => db.query("select public.read_avatar_run($1)", [runId]), /AVATAR_NOT_FOUND/, "another account cannot read the run");
  await assert.rejects(() => db.query("insert into public.avatar_runs(id,owner_id,kind,theme_id,theme_version,status,expires_at) values('af000000-0000-4000-8000-000000000021',$1,'generate','cyberpunk',1,'queued',clock_timestamp()+interval '600 seconds')", [other]),
    /permission denied/, "a client cannot insert avatar runs directly");
  await assert.rejects(() => db.query("update public.avatar_runs set result='{}'"), /permission denied/, "a client cannot write avatar results");
  await assert.rejects(() => db.query("delete from public.avatar_runs"), /permission denied/, "a client cannot delete avatar runs");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from public.avatar_runs where owner_id=$1", [owner])).rows[0].count, 1,
    "no refused client write changed the stored run");
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
