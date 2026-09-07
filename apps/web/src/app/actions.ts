"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { BlueprintSnapshot } from "@blueprint/domain";

import { blueprintApplication } from "@/lib/application";
import { recordProductEvent } from "@/lib/product-events";
import { requestActor } from "@/lib/supabase/request";
import { createServerSupabase } from "@/lib/supabase/server";

export async function createProposalAction(input: {
  draft: BlueprintSnapshot;
  baseVersion: number;
  clientMutationId: string;
}) {
  const context = await requestActor();
  if (!context) return { ok: false as const, code: "unauthenticated" as const };
  try {
    const result = await blueprintApplication(context.client).createProposal(context.actor, input);
    await recordProductEvent(
      context.client,
      context.actor,
      result.ok ? "proposal_created" : result.code === "version_conflict" ? "proposal_conflict" : "proposal_created",
      { entityType: "blueprint", entityId: input.draft.id, ...(!result.ok ? { resultCode: result.code } : {}) },
    );
    return result;
  } catch {
    return { ok: false as const, code: "unavailable" as const };
  }
}

export async function applyProposalAction(input: {
  proposalId: string;
  expectedVersion: number;
  clientMutationId: string;
}) {
  const context = await requestActor();
  if (!context) return { ok: false as const, code: "unauthenticated" as const };
  try {
    const result = await blueprintApplication(context.client).applyProposal(context.actor, input);
    await recordProductEvent(
      context.client,
      context.actor,
      result.ok ? "proposal_applied" : result.code === "version_conflict" ? "proposal_conflict" : "proposal_applied",
      { entityType: "proposal", entityId: input.proposalId, ...(!result.ok ? { resultCode: result.code } : {}) },
    );
    if (result.ok) revalidatePath("/");
    return result;
  } catch {
    return { ok: false as const, code: "unavailable" as const };
  }
}

export async function rejectProposalAction(input: { proposalId: string }) {
  const context = await requestActor();
  if (!context) return { ok: false as const, code: "unauthenticated" as const };
  try {
    const result = await blueprintApplication(context.client).rejectProposal(context.actor, input);
    await recordProductEvent(context.client, context.actor, "proposal_rejected", {
      entityType: "proposal",
      entityId: input.proposalId,
      ...(!result.ok ? { resultCode: result.code } : {}),
    });
    return result;
  } catch {
    return { ok: false as const, code: "unavailable" as const };
  }
}

export async function logoutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
