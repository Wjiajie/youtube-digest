import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { accountPreferencesSchema, type AccountPreferences, type Actor, type ApplicationResult } from "@blueprint/domain";
import { themes } from "@blueprint/ui/theme";

const preferenceColumns = "theme_id, theme_version, preferences_revision";
const saveThemeSchema = z.strictObject({
  theme: accountPreferencesSchema.shape.theme,
  expectedRevision: z.int().nonnegative(),
});

export async function readAccountPreferences(
  client: SupabaseClient,
  actor: Actor,
): Promise<ApplicationResult<AccountPreferences>> {
  const { data, error } = await client.from("profiles").select(preferenceColumns).eq("id", actor.userId).maybeSingle();
  if (error) throw error;
  return data ? { ok: true, value: fromRow(data) } : { ok: false, code: "not_found" };
}

export async function saveAccountTheme(
  client: SupabaseClient,
  actor: Actor,
  input: unknown,
): Promise<ApplicationResult<AccountPreferences>> {
  if (actor.client !== "web") return { ok: false, code: "forbidden" };
  const parsed = saveThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const { theme, expectedRevision } = parsed.data;
  if (!Object.values(themes).some((entry) => entry.id === theme.id && entry.version === theme.version)) {
    return { ok: false, code: "invalid" };
  }
  const { data, error } = await client.from("profiles")
    .update({ theme_id: theme.id, theme_version: theme.version })
    .eq("id", actor.userId)
    .eq("preferences_revision", expectedRevision)
    .select(preferenceColumns)
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true, value: fromRow(data) } : { ok: false, code: "version_conflict" };
}

function fromRow(row: { theme_id: unknown; theme_version: unknown; preferences_revision: unknown }): AccountPreferences {
  return accountPreferencesSchema.parse({
    theme: { id: row.theme_id, version: row.theme_version },
    revision: row.preferences_revision,
  });
}
