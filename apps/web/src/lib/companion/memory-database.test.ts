import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalDatabase } from "./local-database";
import { openConversation, readMessages } from "./store";
import {
  buildConversationContext,
  compactConversation,
  readConversationContext,
  type MemorySummarizer,
} from "./memory";

type Database = Awaited<ReturnType<typeof createLocalDatabase>>;
type Entry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  interrupted: boolean;
  created_at: string;
};
const migrations = path.resolve("supabase/migrations");
const content = {
  summary: "用户正在练习摄影，已讨论构图和自然光。",
  facts: ["每周可投入两小时。"],
  openQuestions: ["下一次拍摄地点尚未决定。"],
};
let database: Database;
let conversationId: string;

function entries(count: number, sameTimestamp = false): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `第 ${index + 1} 条原始对话`,
    interrupted: false,
    created_at: new Date(Date.UTC(2026, 9, 25, 10, 0, sameTimestamp ? 0 : index)).toISOString(),
  }));
}

async function insert(db: Database, conversation: string, values: Entry[]) {
  const result = await db.query(`
    insert into public.companion_messages
      (id,owner_id,conversation_id,role,text,modality,interrupted,created_at)
    select x.id,$1::uuid,$2::uuid,x.role,x.text,'text',x.interrupted,x.created_at
    from jsonb_to_recordset($3::jsonb)
      as x(id uuid,role text,text text,interrupted boolean,created_at timestamptz)
  `, [db.actor.userId, conversation, JSON.stringify(values)]);
  expect(result.error).toBeNull();
}

async function read(db = database, conversation = conversationId) {
  const result = await db.client.rpc("read_companion_context", {
    p_conversation_id: conversation,
  });
  expect(result.error).toBeNull();
  return result.data;
}

async function save(throughId: string, revision = 0, db = database, conversation = conversationId) {
  return db.client.rpc("save_companion_memory", {
    p_conversation_id: conversation,
    p_expected_revision: revision,
    p_through_id: throughId,
    p_content: content,
  });
}

beforeAll(async () => {
  database = await createLocalDatabase("memory://", migrations);
}, 30000);

beforeEach(async () => {
  vi.stubEnv("BLUEPRINT_COMPANION_MEMORY_ENABLED", "true");
  const cleared = await database.client.from("companion_conversations")
    .delete().eq("owner_id", database.actor.userId);
  expect(cleared.error).toBeNull();
  conversationId = await openConversation(database.client, database.actor);
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => {
  await database?.close();
});

describe("actual PostgreSQL conversation memory persistence", () => {
  it("connects local compaction to durable context and avoids summarizing an unchanged small remainder", async () => {
    const values = entries(18);
    await insert(database, conversationId, values);
    const ctx = { client: database.client, actor: database.actor, conversationId };
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    await compactConversation(ctx, summarize);
    const state = await readConversationContext(ctx);
    expect(state.available).toBe(true);
    expect(state.memory).toEqual(expect.objectContaining({
      revision: 1,
      content,
      throughId: values[11].id,
    }));
    expect(state.pending.map((entry) => entry.id)).toEqual(values.slice(12).map((entry) => entry.id));
    expect(buildConversationContext(state.recent, state.memory).memoryText).toContain(content.summary);
    await compactConversation(ctx, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect((await readMessages(ctx)).map((entry) => entry.text)).toEqual(values.map((entry) => entry.text));
  });

  it("continues building context without advancing the cursor when the injected summarizer fails", async () => {
    const values = entries(19);
    await insert(database, conversationId, values);
    const ctx = { client: database.client, actor: database.actor, conversationId };
    const summarize = vi.fn<MemorySummarizer>().mockRejectedValue(new Error("local summary fixture unavailable"));
    await compactConversation(ctx, summarize);
    const state = await readConversationContext(ctx);
    expect(state.available).toBe(true);
    expect(state.memory).toBeNull();
    expect(state.pending.map((entry) => entry.id)).toEqual(values.map((entry) => entry.id));
    const context = buildConversationContext(state.recent, state.memory);
    expect(context.memoryText).toBe("");
    expect(context.messages.at(-1)).toEqual({ role: "user", content: values[18].text });
    expect((await readMessages(ctx))).toHaveLength(19);
    await compactConversation(ctx, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("rolls a thousand-message archive through bounded contexts and carries previous facts into each fixture summary", async () => {
    const values = entries(1000);
    values[0].text = "用户明确陈述：每周可投入两小时。";
    for (const entry of values.slice(-20)) entry.text += "连续对话".repeat(175);
    await insert(database, conversationId, values);
    const ctx = { client: database.client, actor: database.actor, conversationId };
    const summarize = vi.fn<MemorySummarizer>(async ({ previous }) => ({
      summary: "这些固定输出仅用于验证长会话摘要的数据流。",
      facts: previous?.facts ?? content.facts,
      openQuestions: [],
    }));
    let stabilized = false;
    for (let round = 0; round < 64; round++) {
      const priorCalls = summarize.mock.calls.length;
      await compactConversation(ctx, summarize);
      const state = await readConversationContext(ctx);
      const context = buildConversationContext(state.recent, state.memory);
      const totalBytes = new TextEncoder().encode(context.memoryText).byteLength +
        context.messages.reduce((total, entry) => total + new TextEncoder().encode(entry.content).byteLength, 0);
      expect(totalBytes).toBeLessThanOrEqual(32000);
      expect(state.memory?.content.facts).toContain(content.facts[0]);
      if (summarize.mock.calls.length === priorCalls) {
        expect(state.pending.length).toBeLessThan(18);
        stabilized = true;
        break;
      }
    }
    expect(stabilized).toBe(true);
    expect(summarize.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(summarize.mock.calls[0][0].previous).toBeNull();
    for (const [input] of summarize.mock.calls.slice(1))
      expect(input.previous?.facts).toContain(content.facts[0]);
    const count = await database.query("select count(*)::integer as total from public.companion_messages where conversation_id=$1", [conversationId]);
    expect(count.error).toBeNull();
    expect(count.data[0].total).toBe(1000);
  }, 30000);

  it("reads the oldest pending prefix and latest context beyond the fifty-message history page", async () => {
    const values = entries(80);
    await insert(database, conversationId, values);
    const before = await read();
    expect(before.memory).toBeNull();
    expect(before.pending.map((entry: Entry) => entry.id)).toEqual(values.slice(0, 64).map((entry) => entry.id));
    expect(before.recent.map((entry: Entry) => entry.id)).toEqual(values.slice(-20).map((entry) => entry.id));
    const history = await readMessages({ client: database.client, actor: database.actor, conversationId });
    expect(history.map((entry) => entry.id)).toEqual(values.slice(-50).map((entry) => entry.id));

    const committed = await save(values[39].id);
    expect(committed.error).toBeNull();
    expect(committed.data.revision).toBe(1);
    const after = await read();
    expect(after.memory.content).toEqual(content);
    expect(after.pending.map((entry: Entry) => entry.id)).toEqual(values.slice(40).map((entry) => entry.id));
    expect(after.recent.map((entry: Entry) => entry.id)).toEqual(values.slice(-20).map((entry) => entry.id));
    const count = await database.query("select count(*)::integer as total from public.companion_messages where conversation_id=$1", [conversationId]);
    expect(count.error).toBeNull();
    expect(count.data[0].total).toBe(80);
  });

  it("uses message IDs to advance a cursor across equal timestamps without skipping or repeating messages", async () => {
    const values = entries(6, true);
    await insert(database, conversationId, [...values].reverse());
    expect((await read()).pending.map((entry: Entry) => entry.id)).toEqual(values.map((entry) => entry.id));
    expect((await save(values[2].id)).error).toBeNull();
    const first = await read();
    expect(first.pending.map((entry: Entry) => entry.id)).toEqual(values.slice(3).map((entry) => entry.id));
    expect(new Date(first.memory.through_created_at).toISOString()).toBe(values[2].created_at);
    expect((await save(values[4].id, 1)).error).toBeNull();
    expect((await read()).pending.map((entry: Entry) => entry.id)).toEqual([values[5].id]);
  });

  it("rejects a stale summary revision and preserves the newer memory receipt", async () => {
    const values = entries(6);
    await insert(database, conversationId, values);
    const first = await save(values[1].id);
    expect(first.error).toBeNull();
    const stale = await database.client.rpc("save_companion_memory", {
      p_conversation_id: conversationId,
      p_expected_revision: 0,
      p_through_id: values[3].id,
      p_content: { ...content, summary: "过期任务不应覆盖的新摘要" },
    });
    expect(stale.error?.code).toBe("40001");
    const current = await read();
    expect(current.memory.revision).toBe(1);
    expect(current.memory.through_id).toBe(values[1].id);
    expect(current.memory.content).toEqual(content);
  });

  it("rejects a same-or-older boundary even with the correct current revision", async () => {
    const values = entries(6, true);
    await insert(database, conversationId, values);
    expect((await save(values[3].id)).error).toBeNull();
    expect((await save(values[3].id, 1)).error?.code).toBe("40001");
    expect((await save(values[1].id, 1)).error?.code).toBe("40001");
    expect((await read()).memory.through_id).toBe(values[3].id);
  });

  it("filters interrupted output from pending and recent context and rejects it as a memory boundary", async () => {
    const values = entries(6);
    values[3].interrupted = true;
    await insert(database, conversationId, values);
    const state = await read();
    expect(state.pending.map((entry: Entry) => entry.id)).not.toContain(values[3].id);
    expect(state.recent.map((entry: Entry) => entry.id)).not.toContain(values[3].id);
    expect((await save(values[3].id)).error?.code).toBe("40001");
    expect((await read()).memory).toBeNull();
  });

  it("isolates memory reads and writes from another authenticated identity", async () => {
    const values = entries(4);
    await insert(database, conversationId, values);
    expect((await save(values[1].id)).error).toBeNull();
    const other = randomUUID();
    const direct = await database.query("select * from public.companion_memories", [], "authenticated", other);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);
    const foreignRead = await database.query("select public.read_companion_context($1::uuid)", [conversationId], "authenticated", other);
    expect(foreignRead.error?.code).toBe("P0002");
    const foreignWrite = await database.query("select public.save_companion_memory($1::uuid,1,$2::uuid,$3::jsonb)",
      [conversationId, values[3].id, JSON.stringify(content)], "authenticated", other);
    expect(foreignWrite.error?.code).toBe("P0002");
    const current = await read();
    expect(current.memory.revision).toBe(1);
    expect(current.memory.through_id).toBe(values[1].id);
  });

  it("cascades memory deletion and prevents a late summary from recreating a cleared conversation", async () => {
    const values = entries(4);
    await insert(database, conversationId, values);
    expect((await save(values[1].id)).error).toBeNull();
    const oldConversation = conversationId;
    const cleared = await database.client.from("companion_conversations")
      .delete().eq("id", oldConversation);
    expect(cleared.error).toBeNull();
    expect((await save(values[3].id, 1, database, oldConversation)).error?.code).toBe("P0002");
    const residual = await database.query("select * from public.companion_memories");
    expect(residual.error).toBeNull();
    expect(residual.data).toEqual([]);
    const replacement = await openConversation(database.client, database.actor);
    expect(replacement).not.toBe(oldConversation);
    expect(await read(database, replacement)).toEqual({ memory: null, pending: [], recent: [] });
  });

  it("preserves the memory revision, cursor and original messages across a disk database restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "blueprint-memory-persistence-"));
    let disk: Database | undefined;
    try {
      disk = await createLocalDatabase(directory, migrations);
      const owner = disk.actor.userId;
      const conversation = await openConversation(disk.client, disk.actor);
      const values = entries(6, true);
      await insert(disk, conversation, values);
      expect((await save(values[2].id, 0, disk, conversation)).error).toBeNull();
      await disk.close();
      disk = undefined;
      disk = await createLocalDatabase(directory, migrations);
      expect(disk.actor.userId).toBe(owner);
      expect(await openConversation(disk.client, disk.actor)).toBe(conversation);
      const restarted = await read(disk, conversation);
      expect(restarted.memory.revision).toBe(1);
      expect(restarted.memory.content).toEqual(content);
      expect(restarted.memory.through_id).toBe(values[2].id);
      expect(restarted.pending.map((entry: Entry) => entry.id)).toEqual(values.slice(3).map((entry) => entry.id));
      expect(restarted.recent).toHaveLength(6);
    } finally {
      await disk?.close();
      // Only remove the exact test directory created above, within the system temp directory.
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
      expect(path.basename(directory)).toMatch(/^blueprint-memory-persistence-/);
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
