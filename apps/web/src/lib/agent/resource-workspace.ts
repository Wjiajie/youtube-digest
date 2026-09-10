import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResourceNodeView, ResourceRunView, ResourceUiResult } from "../../app/resources/resource-view";
import { createSupabaseBlueprintStore } from "../supabase/store";
import { createResourceRunAccess, resourceRunFailure } from "./resource-run-access";
import type { ResourceRun } from "./resource-run";

const historyRow = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), node_id: z.uuid(), kind: z.enum(["discover", "captions", "match"]), created_at: z.iso.datetime({ offset: true }) });
const childRow = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), source_run_id: z.uuid() });
const adoptionRow = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), source_run_id: z.uuid(), video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(), created_at: z.iso.datetime({ offset: true }) });
function project(run: Exclude<ResourceRun, { status: "cleared" }>, childId: string | null): Exclude<ResourceRunView, { status: "cleared" }> {
  if (!run.contentExpiresAt || Date.parse(run.contentExpiresAt) <= Date.now()) throw new Error("Evidence expired during display read");
  const goal = run.blueprint.goals.find(goal => goal.stages.some(stage => stage.nodes.some(node => node.id === run.nodeId)))!;
  const node = goal.stages.flatMap(stage => stage.nodes).find(node => node.id === run.nodeId)!;
  const result = run.result;
  const discovery = result?.status === "discovered" ? result : run.discovery;
  const matched = result && "assessments" in result ? result : null;
  const nextKind = run.status === "ready" && result?.status === "discovered" && childId === null
    ? result.candidates.some(candidate => candidate.transcript.status === "pending") ? "captions"
      : result.candidates.some(candidate => candidate.eligibleForMatching) ? "match" : null : null;
  return { id: run.id, nodeId: run.nodeId, nodeTitle: node.title, goalId: goal.id, goalTitle: goal.title, blueprintVersion: run.blueprintVersion,
    bindings: node.resources.map(binding => ({ id: binding.id, videoId: binding.externalId, url: binding.url })),
    kind: run.kind, sourceRunId: run.sourceRunId, childId, nextKind, status: run.status, createdAt: run.createdAt, expiresAt: run.expiresAt, contentExpiresAt: run.contentExpiresAt,
    preferences: run.preferences, learnerContext: run.learnerContext, skillVersion: run.skill?.version ?? null,
    result: result ? { status: result.status, summary: matched?.summary ?? null,
      rejected: result.status === "no_candidates" ? result.rejected : discovery?.rejected ?? [], uninspectedCount: discovery?.uninspectedVideoIds.length ?? 0,
      candidates: (discovery?.candidates ?? []).map(candidate => {
        const assessment = matched?.assessments.find(item => item.videoId === candidate.video.videoId);
        const coverage = matched?.coverage.find(item => item.videoId === candidate.video.videoId);
        return { videoId: candidate.video.videoId, url: candidate.url, title: candidate.video.title, channel: candidate.video.channelTitle,
          publishedAt: candidate.video.publishedAt, durationSeconds: candidate.video.durationSeconds, transcriptStatus: candidate.transcript.status,
          language: candidate.transcript.status === "ready" ? candidate.transcript.language : null,
          languageFallback: candidate.languageFallback, eligible: candidate.eligibleForMatching,
          assessment: assessment && coverage ? { role: assessment.role, relevance: assessment.relevance, levelFit: assessment.levelFit,
            languageFit: assessment.languageFit, timeFit: assessment.timeFit, freshness: assessment.freshness, limitations: assessment.limitations,
            evidence: assessment.evidence.map(({ quote, offsetMs }) => ({ quote, offsetMs })), totalSegments: coverage.totalSegments,
            sampledSegments: coverage.sampledSegments, textTruncated: coverage.textTruncated } : null };
      }),
    } : null };
}

/** Account-scoped display reads/cancellation never require execution keys or call providers. */
export function createResourceWorkspace(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity }, access = createResourceRunAccess(client, actor);
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function record(id: string, operation: "read" | "cancel" | "clear"): Promise<ResourceUiResult<ResourceRunView>> {
    if (!allowed) return { ok: false, code: "forbidden" };
    try {
      const current = await access[operation](id);
      if (!current.ok) return current;
      const child = await client.from("resource_runs").select("id,owner_id,source_run_id").eq("owner_id", actor.userId).eq("source_run_id", id).limit(2);
      if (child.error) return resourceRunFailure(child.error);
      const children = z.array(childRow).max(1).parse(child.data);
      if (children.some(row => row.owner_id !== actor.userId || row.source_run_id !== id)) throw new Error("Invalid resource successor");
      const attempts = await client.from("resource_adoptions").select("id,owner_id,source_run_id,video_id,created_at")
        .eq("owner_id", actor.userId).eq("source_run_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20);
      if (attempts.error) return resourceRunFailure(attempts.error);
      const rows = z.array(adoptionRow).max(20).parse(attempts.data);
      if (rows.some(row => row.owner_id !== actor.userId || row.source_run_id !== id)) throw new Error("Invalid adoption history");
      if (current.run.status === "cleared") return { ok: true, value: { id: current.run.id, nodeId: current.run.nodeId,
        blueprintVersion: current.run.blueprintVersion, sourceRunId: current.run.sourceRunId, status: "cleared", clearedAt: current.run.clearedAt, clearReason: current.run.clearReason ?? "manual", result: null,
        childId: children[0]?.id ?? null, adoptions: rows.map(row => ({ id: row.id, createdAt: row.created_at })) } };
      return { ok: true, value: { ...project(current.run, children[0]?.id ?? null), adoptions: rows.map(row => {
        if (row.video_id === null) throw new Error("Source cleared during display read");
        return { id: row.id, videoId: row.video_id, createdAt: row.created_at };
      }) } };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return { read: (id: string) => record(id, "read"), cancel: (id: string) => record(id, "cancel"), clear: (id: string) => record(id, "clear"),
    async node(nodeId: string, offset = 0): Promise<ResourceUiResult<ResourceNodeView>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      if (!z.uuid().safeParse(nodeId).success || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false, code: "invalid" };
      try {
        const blueprint = await createSupabaseBlueprintStore(client).getMainBlueprint(actor.userId);
        const goal = blueprint?.goals.find(goal => goal.stages.some(stage => stage.nodes.some(node => node.id === nodeId && node.type === "learn")));
        const node = goal?.stages.flatMap(stage => stage.nodes).find(node => node.id === nodeId);
        if (!blueprint || !goal || !node) return { ok: false, code: "not_found" };
        const records = await client.from("resource_runs").select("id,owner_id,node_id,kind,created_at").eq("owner_id", actor.userId).eq("node_id", nodeId)
          .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 20);
        if (records.error) return resourceRunFailure(records.error);
        const rows = z.array(historyRow).max(21).parse(records.data);
        if (rows.some(row => row.owner_id !== actor.userId || row.node_id !== nodeId)) throw new Error("Invalid resource history");
        return { ok: true, value: { nodeId, nodeTitle: node.title, goalId: goal.id, goalTitle: goal.title, blueprintVersion: blueprint.version,
          description: node.description ?? null, completionCriteria: node.completionCriteria ?? null, estimatedMinutes: node.estimatedMinutes ?? null,
          records: rows.slice(0, 20).map(row => ({ id: row.id, kind: row.kind, createdAt: row.created_at })), offset, hasMore: rows.length > 20 } };
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
