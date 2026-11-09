import { z } from "zod";
import {
  goalBriefReadiness,
  recordProgressEvidenceSchema,
} from "@blueprint/domain";
import { readNodeStatusWorkspace } from "../node-status";
import { listGoalBriefs, readGoalBrief } from "../goal-briefs";
import { createPlanningRunAccess } from "../agent/planning-access";
import { createPlanningApprovalAccess } from "../agent/planning-approval";
import { createCloudPathPlanner } from "../agent/cloud-path-planner";
import {
  planningConfiguration,
  createPlanningModel,
  createPlanningWorker,
} from "../agent/planning-runtime";
import {
  appendMessage,
  checked,
  propose,
  type CompanionContext,
} from "./store";
import {
  avatarCueSchema,
  toolInputs,
  type ToolName,
  type AvatarCue,
} from "./contracts";
import { localCompanionMode } from "./local-config";

export type ToolContext = CompanionContext & {
  accessToken?: string;
  messageId: string;
  schedule: (work: () => Promise<void>) => void;
  cue: (cue: AvatarCue) => void;
};
export async function executeTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
  callId: string,
): Promise<any> {
  if (!Object.hasOwn(toolInputs, name))
    return { ok: false, code: "unknown_tool" };
  const parsed = toolInputs[name as ToolName].safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid_arguments",
      issues: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    };
  const args = parsed.data as any;
  if (name === "avatar_cue") {
    ctx.cue(avatarCueSchema.parse(args));
    return { ok: true, queued: true };
  }
  if (name === "read_goals") {
    const [workspace, briefs] = await Promise.all([
      readNodeStatusWorkspace(ctx.client, ctx.actor),
      listGoalBriefs(ctx.client, ctx.actor),
    ]);
    if (!workspace.ok) return workspace;
    const current = workspace.value.current,
      complete = new Set(
        current
          .filter((s) => s.status === "completed")
          .map((s) => s.context.nodeId),
      );
    const nodes = workspace.value.blueprint.goals.flatMap((g) =>
      g.stages.flatMap((s) =>
        s.nodes.map((n) => ({ ...n, goalTitle: g.title, stageTitle: s.title })),
      ),
    );
    return {
      ok: true,
      blueprintId: workspace.value.blueprint.id,
      version: workspace.value.blueprint.version,
      goals: workspace.value.blueprint.goals
        .map((g) => ({ id: g.id, title: g.title }))
        .slice(0, 20),
      nextSteps: nodes
        .filter(
          (n) =>
            !complete.has(n.id) &&
            n.dependencyIds.every((id) => complete.has(id)),
        )
        .slice(0, 5)
        .map((n) => ({
          id: n.id,
          title: n.title,
          goalTitle: n.goalTitle,
          stageTitle: n.stageTitle,
          completionCriteria: n.completionCriteria?.slice(0, 1500) ?? "待明确",
          estimatedMinutes: n.estimatedMinutes,
        })),
      briefs: briefs.ok
        ? briefs.value.briefs.slice(0, 5).map((b) => ({
            id: b.id,
            status: b.status,
            revision: b.revision,
            outcome: b.content.outcome,
          }))
        : briefs,
    };
  }
  if (name === "draft_goal") {
    const readiness = goalBriefReadiness(args.content);
    if (readiness.missing.length)
      return {
        ok: false,
        code: "needs_clarification",
        missing: readiness.missing,
      };
    return {
      ok: true,
      requiresConfirmation: true,
      action: await propose(ctx, ctx.messageId, callId, "goal", args),
    };
  }
  if (name === "prepare_progress") {
    const workspace = await readNodeStatusWorkspace(ctx.client, ctx.actor);
    if (!workspace.ok) return workspace;
    const node = workspace.value.blueprint.goals
      .flatMap((g) => g.stages.flatMap((s) => s.nodes))
      .find((n) => n.id === args.nodeId);
    if (!node) return { ok: false, code: "not_found" };
    // Validate the same URL/text limits as the formal RPC adapter, without extra fields.
    const valid = recordProgressEvidenceSchema.safeParse({
      nodeId: args.nodeId,
      text: args.text,
      artifactUrl: args.artifactUrl,
      expectedVersion: workspace.value.blueprint.version,
      clientMutationId: crypto.randomUUID(),
    });
    if (!valid.success)
      return { ok: false, code: "invalid", issues: valid.error.issues };
    return {
      ok: true,
      requiresConfirmation: true,
      action: await propose(ctx, ctx.messageId, callId, "progress", {
        ...args,
        nodeTitle: node.title,
        expectedVersion: workspace.value.blueprint.version,
        expectedStatusRevision:
          workspace.value.current.find((s) => s.context.nodeId === args.nodeId)
            ?.revision ?? 0,
      }),
    };
  }
  if (name === "generate_plan") {
    const brief = await readGoalBrief(ctx.client, ctx.actor, args.briefId);
    if (!brief.ok || brief.value.status !== "confirmed")
      return { ok: false, code: "needs_confirmed_goal" };
    const local = localCompanionMode()
      ? await (await import("./local-database")).localDatabase()
      : null;
    const config = local ? null : planningConfiguration();
    const apiKey = local ? process.env.DEEPSEEK_API_KEY : config?.apiKey;
    if (!apiKey || (!local && !config))
      return {
        ok: false,
        code: "planning_disabled",
        message: "规划服务尚未配置，已确认的目标会保留。",
      };
    const workspace = await readNodeStatusWorkspace(ctx.client, ctx.actor);
    if (!workspace.ok) return workspace;
    // A pending planning action is also the durable run identity on reload/retry.
    const existing = checked(
      await ctx.client
        .from("companion_actions")
        .select("*")
        .eq("owner_id", ctx.actor.userId)
        .eq("kind", "planning")
        .eq("status", "pending")
        .contains("payload", { briefId: args.briefId })
        .gt("expires_at", new Date().toISOString())
        .limit(1),
    );
    if (existing?.length) {
      const status = await createPlanningRunAccess(ctx.client, ctx.actor).read(
        existing[0].payload.runId,
      );
      if (
        status.ok &&
        ["failed", "cancelled", "stale", "interrupted"].includes(
          status.run.status,
        )
      )
        checked(
          await ctx.client.rpc("cancel_companion_action", {
            p_id: existing[0].id,
          }),
        );
      else
        return {
          ok: true,
          runId: existing[0].payload.runId,
          status: status.ok ? status.run.status : "running",
        };
    }
    const action = await propose(ctx, ctx.messageId, callId, "planning", {
      runId: crypto.randomUUID(),
      briefId: args.briefId,
    });
    const runId = action.payload.runId as string;
    if (action.status !== "pending")
      return { ok: true, runId, status: "finished_or_cancelled" };
    const session = await ctx.client.auth.getSession();
    const token = session.data.session?.access_token;
    // Delegated gateway clients have an explicit user access token.
    const accessToken =
      token ?? (ctx as ToolContext & { accessToken?: string }).accessToken;
    if (!accessToken) {
      checked(
        await ctx.client.rpc("cancel_companion_action", { p_id: action.id }),
      );
      return { ok: false, code: "unauthenticated" };
    }
    ctx.schedule(async () => {
      const result = await createCloudPathPlanner({
        ...ctx,
        worker: local?.worker ?? createPlanningWorker(config!, accessToken),
        model: createPlanningModel(apiKey),
      }).run(
        {
          runId,
          briefId: brief.value.id,
          expectedBriefRevision: brief.value.revision,
          expectedBlueprintVersion: workspace.value.blueprint.version,
          startDate: new Date().toISOString().slice(0, 10),
        },
        AbortSignal.timeout(80_000),
      );
      if (!result.ok || result.run.status !== "ready") {
        checked(
          await ctx.client.rpc("cancel_companion_action", { p_id: action.id }),
        );
        await appendMessage(
          ctx,
          crypto.randomUUID(),
          "assistant",
          "计划暂时未能生成，已确认的目标会保留。可以稍后再试。",
          "text",
        );
      }
    });
    return { ok: true, runId: action.payload.runId, status: "running" };
  }
  const run = await createPlanningRunAccess(ctx.client, ctx.actor).read(
    args.runId,
  );
  if (!run.ok || run.run.status !== "ready") {
    if (
      run.ok &&
      ["failed", "cancelled", "stale", "interrupted"].includes(run.run.status)
    ) {
      const pending = checked(
        await ctx.client
          .from("companion_actions")
          .select("id")
          .eq("owner_id", ctx.actor.userId)
          .eq("kind", "planning")
          .eq("status", "pending")
          .contains("payload", { runId: args.runId }),
      );
      for (const a of pending ?? [])
        checked(
          await ctx.client.rpc("cancel_companion_action", { p_id: a.id }),
        );
    }
    return run;
  }
  const approval = await createPlanningApprovalAccess(
    ctx.client,
    ctx.actor,
  ).prepare(args.runId);
  if (!approval.ok || !approval.value.proposal || !approval.value.sourceCurrent)
    return { ok: false, code: "stale_or_unavailable_plan" };
  const p = approval.value.proposal;
  const action = await propose(
    ctx,
    ctx.messageId,
    `plan:${args.runId}`,
    "plan",
    {
      runId: args.runId,
      proposalId: p.id,
      baseVersion: p.baseVersion,
      draft: p.draft,
    },
  );
  const pending = checked(
    await ctx.client
      .from("companion_actions")
      .select("id")
      .eq("owner_id", ctx.actor.userId)
      .eq("kind", "planning")
      .eq("status", "pending")
      .contains("payload", { runId: args.runId }),
  );
  for (const a of pending ?? [])
    checked(await ctx.client.rpc("cancel_companion_action", { p_id: a.id }));
  return { ok: true, requiresConfirmation: true, action };
}
