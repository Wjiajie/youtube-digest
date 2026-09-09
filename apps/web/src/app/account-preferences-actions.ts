"use server";

import type { AccountPreferences, ApplicationResult } from "@blueprint/domain";

import { saveAccountTheme } from "@/lib/account-preferences";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function saveAccountThemeAction(input: unknown): Promise<ApplicationResult<AccountPreferences>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    return await saveAccountTheme(context.value.client, context.value.actor, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
