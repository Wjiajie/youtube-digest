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
    const migration = await readFile(new URL(file, migrationDirectory), "utf8");
    await db.exec(migration.replaceAll("extensions.citext", "text"));
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
    schemaVersion: 1,
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

  console.log("Migration contract passed: proposals, idempotency, ownership, RLS, and existing-account preferences upgrade.");
} finally {
  await db.close();
}

async function becomeUser(userId) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("select set_config('request.jwt.claims', '{}', false)");
}
