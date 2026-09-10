import { expect, test } from "vitest";
import { transcriptFixture } from "../transcript-e2e/fixture";
import { readLearningTranscript } from "../src/lib/learning-transcript";

test("real account reads bounded original pages, rejects another owner, and loses access after explicit clearing without changing history", async () => {
  const owner = await transcriptFixture(), other = await transcriptFixture();
  try {
    const actor = { userId: owner.ownerId, client: "web" as const };
    expect(await readLearningTranscript(owner.client, actor, owner.command)).toMatchObject({ ok: true, value: { status: "unavailable", reason: "not_acquired" } });
    const sourceRunId = await owner.acquire();
    const first = await readLearningTranscript(owner.client, actor, owner.command);
    expect(first).toMatchObject({ ok: true, value: { status: "ready", sourceRunId, offset: 0, totalSegments: 21 } });
    if (!first.ok || first.value.status !== "ready") throw new Error("Missing transcript");
    expect(first.value.segments).toHaveLength(20);
    const last = await readLearningTranscript(owner.client, actor, { ...owner.command, sourceRunId, offset: 20 });
    expect(last).toMatchObject({ ok: true, value: { status: "ready", segments: [{ text: "最后一段：用自己的照片解释你的选择。", offsetMs: 300000, durationMs: 10000 }] } });
    expect(await readLearningTranscript(other.client, { userId: other.ownerId, client: "web" }, owner.command)).toEqual({ ok: false, code: "not_found" });
    expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: sourceRunId })).error).toBeNull();
    expect(await readLearningTranscript(owner.client, actor, { ...owner.command, sourceRunId, offset: 20 })).toMatchObject({ ok: true, value: { status: "unavailable", reason: "cleared" } });
    const blueprint = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.ownerId });
    expect(blueprint.data.version).toBe(1); expect(blueprint.data.goals[0].stages[0].nodes[0].resources[0].id).toBe(owner.bindingId);
  } finally { await owner.cleanup(); await other.cleanup(); }
});
