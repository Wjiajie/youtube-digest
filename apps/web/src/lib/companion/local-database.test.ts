import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalDatabase, localDatabase } from "./local-database";
import {
  appendMessage,
  openConversation,
  propose,
  readMessages,
  savePreferences,
  preferences,
} from "./store";
import { defaultPreferences } from "./contracts";
import { executeTool } from "./tools";
let database: Awaited<ReturnType<typeof createLocalDatabase>>,
  directory: string;
const migrations = path.resolve("supabase/migrations");
afterEach(() => vi.unstubAllEnvs());
it("cannot open application local storage outside explicit development mode", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BLUEPRINT_COMPANION_STORAGE", "local");
  expect(() => localDatabase()).toThrow("local_storage_disabled");
});
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "blueprint-companion-local-"));
  database = await createLocalDatabase(directory, migrations);
}, 20000);
afterAll(async () => {
  await database?.close();
  await rm(directory, { recursive: true, force: true });
});
async function context() {
  return {
    client: database.client,
    actor: database.actor,
    conversationId: await openConversation(database.client, database.actor),
  };
}
it("persists actual messages and preferences across database restart", async () => {
  const ctx = await context();
  await appendMessage(ctx, randomUUID(), "user", "本地保存的记录", "text");
  await savePreferences(
    ctx.client,
    ctx.actor,
    { ...defaultPreferences, volume: 0.4 },
    0,
  );
  const owner = database.actor.userId;
  await database.close();
  database = await createLocalDatabase(directory, migrations);
  expect(database.actor.userId).toBe(owner);
  expect((await readMessages(await context()))[0].text).toBe("本地保存的记录");
  expect(
    (await preferences(database.client, database.actor)).value.volume,
  ).toBe(0.4);
  expect(
    (
      await savePreferences(
        database.client,
        database.actor,
        defaultPreferences,
        1,
      )
    ).revision,
  ).toBe(2);
  await expect(
    savePreferences(database.client, database.actor, defaultPreferences, 1),
  ).rejects.toThrow("40001");
}, 20000);
it("runs production confirmation SQL, rejects stale spoken confirmation, and replays one receipt", async () => {
  const ctx = await context(),
    source = randomUUID();
  await appendMessage(ctx, source, "user", "我想练习摄影", "text");
  const action = await propose(ctx, source, randomUUID(), "goal", {
    content: {
      schemaVersion: 1,
      outcome: "完成摄影练习",
      startingPoint: "已掌握相机基础",
      weeklyMinutes: 120,
      targetDate: null,
      constraints: "",
      successCriteria: "完成三张并复盘",
    },
  });
  const rejected = await ctx.client.rpc("confirm_companion_action", {
    p_id: action.id,
    p_mode: "voice",
    p_message_id: source,
  });
  expect(rejected.error?.code).toBe("42501");
  const message = randomUUID();
  await appendMessage(ctx, message, "user", "确认保存", "voice");
  const result = await ctx.client.rpc("confirm_companion_action", {
    p_id: action.id,
    p_mode: "voice",
    p_message_id: message,
  });
  expect(result.error).toBeNull();
  expect(result.data.status).toBe("confirmed");
  const replay = await ctx.client.rpc("confirm_companion_action", {
    p_id: action.id,
    p_mode: "click",
    p_message_id: null,
  });
  expect(replay.data).toEqual(result.data);
  const goals = await executeTool(
    { ...ctx, messageId: message, schedule: () => {}, cue: () => {} },
    "read_goals",
    {},
    randomUUID(),
  );
  expect(goals.ok).toBe(true);
  expect(goals.briefs.some((b: any) => b.id === action.id)).toBe(true);
});
it("applies PostgreSQL RLS to local actor queries and disallows direct receipt forgery", async () => {
  const ctx = await context();
  const result = await ctx.client
    .from("companion_actions")
    .update({ status: "applied" })
    .eq("owner_id", ctx.actor.userId);
  expect(result.error?.code).toBe("42501");
  const other = await database.query(
    "select * from public.companion_conversations",
    [],
    "authenticated",
    randomUUID(),
  );
  expect(other.data).toEqual([]);
});
