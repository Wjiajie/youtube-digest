"use server";

import type { AccountPreferences, ApplicationResult } from "@blueprint/domain";

import { readAccountPreferences, saveAccountTheme } from "@/lib/account-preferences";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function saveAccountThemeAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<AccountPreferences>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await saveAccountTheme(context.value.client, context.value.actor, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function readAccountThemeAction(expectedAccountId: string): Promise<ApplicationResult<AccountPreferences>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readAccountPreferences(context.value.client, context.value.actor);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
