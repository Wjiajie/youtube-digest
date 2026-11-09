import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL functions and RLS, with no cloud account, model or audio service.
const db = new PGlite();
const owner = randomUUID(),
  outsider = randomUUID(),
  conversation = randomUUID();
const content = {
  schemaVersion: 1,
  outcome: "完成摄影练习",
  startingPoint: "已掌握基础操作",
  targetDate: null,
  weeklyMinutes: 120,
  constraints: "",
  successCriteria: "拍摄并复盘三组照片",
};
let checks = 0;
async function check(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}
async function admin() {
  await db.exec("reset role");
}
async function actor(id = owner, extra = {}) {
  await admin();
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [id, JSON.stringify(extra)],
  );
  await db.exec("set role authenticated");
}
async function rejects(sql, params, code) {
  await assert.rejects(
    db.query(sql, params),
    (error) => {
      if (error.code !== code)
        console.error(`Unexpected SQLSTATE: ${error.code}; ${error.message}`);
      return error.code === code;
    },
    `expected SQLSTATE ${code}`,
  );
}
async function message(
  text,
  { role = "user", modality = "voice", offset = 0, interrupted = false } = {},
) {
  const id = randomUUID();
  await admin();
  await db.query(
    "insert into public.companion_messages(id,conversation_id,owner_id,role,modality,text,interrupted,created_at) values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 second')",
    [id, conversation, owner, role, modality, text, interrupted, offset],
  );
  return id;
}
async function action(
  kind = "goal",
  payload = { content },
  { offset = -10, expires = 1800 } = {},
) {
  const id = randomUUID(),
    source = await message("准备一个目标", { offset: offset - 1 });
  await db.query(
    "insert into public.companion_actions(id,conversation_id,owner_id,source_message_id,kind,payload,call_key,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 second',clock_timestamp()+$9*interval '1 second')",
    [
      id,
      conversation,
      owner,
      source,
      kind,
      JSON.stringify(payload),
      id,
      offset,
      expires,
    ],
  );
  return id;
}
async function confirm(id, mode = "click", messageId = null) {
  return (
    await db.query("select public.confirm_companion_action($1,$2,$3) receipt", [
      id,
      mode,
      messageId,
    ])
  ).rows[0].receipt;
}

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;`);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(new URL(name, directory), "utf8"))
      .replace(
        "create extension if not exists citext with schema extensions;",
        "",
      )
      .replaceAll("extensions.citext", "text");
    await db.exec(sql);
  }
  await db.query(
    "insert into auth.users(id,email) values($1,'companion-owner@example.test'),($2,'companion-other@example.test')",
    [owner, outsider],
  );
  await db.query(
    "insert into public.companion_conversations(id,owner_id) values($1,$2)",
    [conversation, owner],
  );
  const blueprint = (
    await db.query("select id from public.blueprints where owner_id=$1", [
      owner,
    ])
  ).rows[0].id;

  await check(
    "owner can read own conversation; other account cannot read or forge it",
    async () => {
      await actor();
      assert.equal(
        (await db.query("select id from public.companion_conversations")).rows
          .length,
        1,
      );
      await actor(outsider);
      assert.equal(
        (await db.query("select id from public.companion_conversations")).rows
          .length,
        0,
      );
      await rejects(
        "insert into public.companion_messages(id,conversation_id,owner_id,role,modality,text) values($1,$2,$3,'user','text','forged')",
        [randomUUID(), conversation, owner],
        "42501",
      );
    },
  );
  await check(
    "extension and anonymous claims cannot access companion data or confirm actions",
    async () => {
      const id = await action();
      for (const claims of [
        { client_id: "some-oauth-client" },
        { is_anonymous: true },
      ]) {
        await actor(owner, claims);
        assert.equal(
          (await db.query("select id from public.companion_conversations")).rows
            .length,
          0,
        );
        await rejects(
          "select public.confirm_companion_action($1,'click',null)",
          [id],
          "42501",
        );
      }
    },
  );
  await check(
    "authenticated clients cannot forge applied receipts or action timestamps",
    async () => {
      const source = await message("目标");
      await actor();
      await rejects(
        "insert into public.companion_actions(id,conversation_id,owner_id,source_message_id,kind,payload,call_key,status) values($1,$2,$3,$4,'goal',$5,$6,'applied')",
        [
          randomUUID(),
          conversation,
          owner,
          source,
          JSON.stringify({ content }),
          randomUUID(),
        ],
        "42501",
      );
      await rejects(
        "update public.companion_messages set created_at=clock_timestamp() where id=$1",
        [source],
        "42501",
      );
    },
  );
  await check(
    "voice confirmation rejects earlier, assistant, interrupted and ambiguous messages",
    async () => {
      for (const options of [
        { offset: -20 },
        { role: "assistant" },
        { interrupted: true },
        { text: "他说确认保存" },
        { text: "不要确认保存" },
        { text: "确认保存吗？" },
      ]) {
        const id = await action();
        const mid = await message(options.text ?? "确认保存", options);
        await actor();
        await rejects(
          "select public.confirm_companion_action($1,'voice',$2)",
          [id, mid],
          "42501",
        );
      }
    },
  );
  await check(
    "voice confirmation must be the latest user message",
    async () => {
      const id = await action(),
        mid = await message("确认保存");
      await message("等等，先不要", { offset: 1 });
      await actor();
      await rejects(
        "select public.confirm_companion_action($1,'voice',$2)",
        [id, mid],
        "42501",
      );
    },
  );
  await check(
    "voice confirmation only targets the latest confirmable pending proposal",
    async () => {
      const older = await action("goal", { content }, { offset: -5 });
      await action("goal", { content }, { offset: -2 });
      const mid = await message("确认保存", { offset: 2 });
      await actor();
      await rejects(
        "select public.confirm_companion_action($1,'voice',$2)",
        [older, mid],
        "42501",
      );
    },
  );
  await check(
    "exact confirmation saves a goal once and retries preserve receipt",
    async () => {
      const id = await action("goal", { content }, { offset: 0 }),
        mid = await message("确认保存！", { offset: 3 });
      await actor();
      const receipt = await confirm(id, "voice", mid);
      assert.equal(receipt.id, id);
      assert.equal(receipt.status, "confirmed");
      assert.deepEqual(await confirm(id), receipt);
      assert.equal(
        (
          await db.query(
            "select revision from public.goal_briefs where id=$1",
            [id],
          )
        ).rows[0].revision,
        1,
      );
    },
  );
  await check(
    "one confirmation message cannot apply a second proposal",
    async () => {
      const older = await action("goal", { content }, { offset: 0 });
      const newer = await action("goal", { content }, { offset: 1 });
      const mid = await message("确认保存", { offset: 5 });
      await actor();
      await confirm(newer, "voice", mid);
      await rejects(
        "select public.confirm_companion_action($1,'voice',$2)",
        [older, mid],
        "42501",
      );
    },
  );
  await check("expired proposals cannot save formal data", async () => {
    const id = await action("goal", { content }, { expires: -1 });
    await actor();
    await rejects(
      "select public.confirm_companion_action($1,'click',null)",
      [id],
      "40001",
    );
    assert.equal(
      (await db.query("select id from public.goal_briefs where id=$1", [id]))
        .rows.length,
      0,
    );
  });
  await check(
    "cancelled proposals cannot be confirmed or write formal data",
    async () => {
      const id = await action();
      await actor();
      await db.query("select public.cancel_companion_action($1)", [id]);
      await rejects(
        "select public.confirm_companion_action($1,'click',null)",
        [id],
        "40001",
      );
      assert.equal(
        (await db.query("select id from public.goal_briefs where id=$1", [id]))
          .rows.length,
        0,
      );
    },
  );

  const goal = randomUUID(),
    stage = randomUUID(),
    node = randomUUID();
  await admin();
  await db.query(
    "insert into public.goals(id,owner_id,blueprint_id,title,position) values($1,$2,$3,'摄影',0)",
    [goal, owner, blueprint],
  );
  await db.query(
    "insert into public.stages(id,owner_id,goal_id,title,position) values($1,$2,$3,'练习',0)",
    [stage, owner, goal],
  );
  await db.query(
    "insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position,estimated_minutes,completion_criteria) values($1,$2,$3,'practice','拍照',0,30,'三张照片')",
    [node, owner, stage],
  );
  await check(
    "progress completion failure rolls back evidence and leaves proposal pending",
    async () => {
      const id = await action("progress", {
        nodeId: node,
        expectedVersion: 0,
        expectedStatusRevision: 99,
        text: "完成三张照片",
        completed: true,
      });
      await actor();
      await rejects(
        "select public.confirm_companion_action($1,'click',null)",
        [id],
        "40001",
      );
      assert.equal(
        (
          await db.query(
            "select id from public.progress_evidence where client_mutation_id=$1",
            [id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select status from public.companion_actions where id=$1",
            [id],
          )
        ).rows[0].status,
        "pending",
      );
    },
  );
  await check(
    "progress and completion commit together; retries cannot add evidence or revisions",
    async () => {
      const id = await action("progress", {
        nodeId: node,
        expectedVersion: 0,
        expectedStatusRevision: 0,
        text: "完成三张照片",
        completed: true,
      });
      await actor();
      const receipt = await confirm(id);
      assert.equal(receipt.status.status, "completed");
      assert.equal(receipt.status.evidence_id, receipt.evidence.id);
      assert.deepEqual(await confirm(id), receipt);
      assert.equal(
        (
          await db.query(
            "select count(*)::int count from public.progress_evidence where client_mutation_id=$1",
            [id],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int count from public.node_status_confirmations where client_mutation_id=$1",
            [id],
          )
        ).rows[0].count,
        1,
      );
    },
  );
  await check(
    "plan confirmation uses immutable prepared proposal and returns applied receipt",
    async () => {
      const brief = await action();
      await actor();
      await confirm(brief);
      const run = randomUUID(),
        draft = {
          schemaVersion: 2,
          id: blueprint,
          version: 0,
          title: "摄影蓝图",
          goals: [
            {
              id: goal,
              title: "摄影",
              position: 0,
              stages: [
                {
                  id: stage,
                  title: "练习",
                  position: 0,
                  nodes: [
                    {
                      id: node,
                      type: "practice",
                      title: "拍照",
                      position: 0,
                      estimatedMinutes: 30,
                      completionCriteria: "三张照片",
                      dependencyIds: [],
                      resources: [],
                    },
                  ],
                },
              ],
            },
          ],
        };
      const result = {
        status: "ready",
        providerMayHaveRun: true,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        draft,
        schedule: [{ nodeId: node, week: 1 }],
        assumptions: [],
        skill: {},
        source: {},
      };
      await admin();
      await db.query(
        "insert into public.path_planning_runs(id,owner_id,brief_id,blueprint_id,brief_revision,blueprint_version,start_date,status,input_brief,input_blueprint,skill,result,expires_at) values($1,$2,$3,$4,1,0,current_date,'ready','{}',$5,'{}',$6,clock_timestamp()+interval '1 hour')",
        [
          run,
          owner,
          brief,
          blueprint,
          JSON.stringify(draft),
          JSON.stringify(result),
        ],
      );
      await actor();
      const prepared = (
        await db.query(
          "select public.prepare_path_planning_proposal($1) value",
          [run],
        )
      ).rows[0].value;
      const id = await action("plan", {
        runId: run,
        proposalId: prepared.proposal.id,
        baseVersion: 0,
      });
      await actor();
      const receipt = await confirm(id);
      assert.equal(receipt.proposal.status, "applied");
      assert.equal(receipt.proposal.appliedVersion, 1);
      assert.deepEqual(await confirm(id), receipt);
      assert.equal(
        (
          await db.query("select version from public.blueprints where id=$1", [
            blueprint,
          ])
        ).rows[0].version,
        1,
      );
    },
  );
  await check(
    "all conversation data and preferences remain isolated after real records exist",
    async () => {
      await actor();
      await db.query(
        "insert into public.companion_preferences(owner_id,value) values($1,$2)",
        [owner, JSON.stringify({ volume: 0.5 })],
      );
      const ownerAction = (
        await db.query("select id from public.companion_actions limit 1")
      ).rows[0].id;
      await actor(outsider);
      for (const table of [
        "companion_conversations",
        "companion_messages",
        "companion_actions",
        "companion_preferences",
      ]) {
        assert.equal(
          (await db.query(`select * from public.${table}`)).rows.length,
          0,
          `${table} must not leak another owner`,
        );
      }
      await rejects(
        "select public.confirm_companion_action($1,'click',null)",
        [ownerAction],
        "P0002",
      );
      await db.query("delete from public.companion_conversations where id=$1", [
        conversation,
      ]);
      await actor();
      assert.equal(
        (await db.query("select id from public.companion_conversations")).rows
          .length,
        1,
      );
    },
  );
  await check(
    "deleting a conversation clears history and pending actions",
    async () => {
      await actor();
      await db.query("delete from public.companion_conversations where id=$1", [
        conversation,
      ]);
      assert.equal(
        (await db.query("select id from public.companion_messages")).rows
          .length,
        0,
      );
      assert.equal(
        (await db.query("select id from public.companion_actions")).rows.length,
        0,
      );
      assert.ok(
        (await db.query("select id from public.goal_briefs")).rows.length > 0,
        "deleting chat must preserve formal goals",
      );
    },
  );
  console.log(`Companion database contract passed: ${checks} scenarios.`);
} catch (error) {
  console.error(
    "Companion database contract failed:",
    error.code ?? error.name,
    error.message,
    error.where ?? "",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
