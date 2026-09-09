"use server";

import type { AccountPreferences, ApplicationResult } from "@blueprint/domain";

import { saveAccountTheme } from "@/lib/account-preferences";
import { requestActor } from "@/lib/supabase/request";

export async function saveAccountThemeAction(input: unknown): Promise<ApplicationResult<AccountPreferences>> {
  try {
    const context = await requestActor();
    if (!context) return { ok: false, code: "unauthenticated" };
    return await saveAccountTheme(context.client, context.actor, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
