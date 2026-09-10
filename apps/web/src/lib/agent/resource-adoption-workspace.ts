import { z } from "zod";
import { blueprintSnapshotSchema, type Actor, type ResourceBinding } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdoptionView, ResourceBindingView } from "../../app/resources/adoption-view";
import type { ResourceUiResult } from "../../app/resources/resource-view";
import { createResourceAdoptionAccess, type ResourceAdoptionResponse } from "./resource-adoption-access";
import { createResourceRunAccess } from "./resource-run-access";

const proposalSchema = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), blueprint_id: z.uuid(), base_version: z.int().nonnegative(),
  status: z.enum(["pending", "applied", "rejected"]), proposed_snapshot: blueprintSnapshotSchema });
const bindings = (items: ResourceBinding[]): ResourceBindingView[] => items.map(item => ({ id: item.id, videoId: item.externalId, url: item.url }));
/** Only affected-node before/after resources reach the browser, never the full proposal or source evidence. */
export function createResourceAdoptionWorkspace(client: SupabaseClient, actor: Actor) {
  const access = createResourceAdoptionAccess(client, actor);
  async function project(response: ResourceAdoptionResponse): Promise<ResourceUiResult<AdoptionView>> {
    if (!response.ok) return response;
    const record = response.adoption;
    try {
      const source = await createResourceRunAccess(client, actor).read(record.sourceRunId);
      if (!source.ok) return source;
      const run = source.run;
      if (run.blueprintId !== record.blueprintId || run.blueprintVersion !== record.blueprintVersion || run.nodeId !== record.nodeId) throw new Error("Source mismatch");
      const goal = run.blueprint.goals.find(goal => goal.stages.some(stage => stage.nodes.some(node => node.id === record.nodeId)))!;
      const node = goal.stages.flatMap(stage => stage.nodes).find(node => node.id === record.nodeId)!;
      const candidate = run.discovery?.candidates.find(candidate => candidate.video.videoId === record.videoId);
      if (!candidate) throw new Error("Missing selected video");
      let proposal: AdoptionView["proposal"] = null, after: ResourceBindingView[] | null = null;
      if (record.proposalId) {
        const selected = await client.from("blueprint_proposals").select("id,owner_id,blueprint_id,base_version,status,proposed_snapshot")
          .eq("id", record.proposalId).eq("owner_id", actor.userId).single();
        if (selected.error) throw new Error("Proposal unavailable");
        const row = proposalSchema.parse(selected.data);
        if (row.id !== record.proposalId || row.owner_id !== actor.userId || row.blueprint_id !== record.blueprintId || row.base_version !== record.blueprintVersion
          || row.proposed_snapshot.id !== record.blueprintId || row.proposed_snapshot.version !== record.blueprintVersion) throw new Error("Proposal source mismatch");
        const nextNode = row.proposed_snapshot.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes)).find(node => node.id === record.nodeId);
        if (!nextNode || !nextNode.resources.some(binding => binding.id === record.newBindingId && binding.externalId === record.videoId)) throw new Error("Missing proposed binding");
        after = bindings(nextNode.resources);
        let appliedVersion: number | null = null;
        if (row.status === "applied") {
          const revision = await client.from("blueprint_revisions").select("version").eq("owner_id", actor.userId).eq("proposal_id", row.id).single();
          if (revision.error) throw new Error("Confirmation unavailable");
          appliedVersion = z.strictObject({ version: z.int().positive() }).parse(revision.data).version;
        }
        proposal = { id: row.id, status: row.status, appliedVersion };
      }
      return { ok: true, value: { id: record.id, sourceRunId: run.id, nodeId: node.id, nodeTitle: node.title, goalId: goal.id, goalTitle: goal.title,
        blueprintVersion: record.blueprintVersion, status: record.status,
        selected: { videoId: record.videoId, title: candidate.video.title, channel: candidate.video.channelTitle }, replaceBindingId: record.replaceBindingId,
        outcome: record.result?.status ?? null, verifiedAt: record.verifiedAt, validUntil: record.validUntil, before: bindings(node.resources), after, proposal } };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return { read: async (id: string) => project(await access.read(id)), cancel: async (id: string) => project(await access.cancel(id)),
    reject: async (id: string) => project(await access.reject(id)),
    apply: async (id: string, proposalId: string, version: number) => project(await access.apply(id, proposalId, version)) };
}
