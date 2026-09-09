import type { PropsWithChildren } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readAccountPreferences } from "@/lib/account-preferences";
import { readAccountThemeAction, saveAccountThemeAction } from "./account-preferences-actions";
import { AccountTheme } from "./account-theme";

export async function AccountThemeShell({ accountId, client, children }: PropsWithChildren<{
  accountId: string;
  client: SupabaseClient;
}>) {
  const initial = await readAccountPreferences(client, { userId: accountId, client: "web" })
    .catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountTheme key={accountId} initial={initial}
    readAction={readAccountThemeAction.bind(null, accountId)}
    saveAction={saveAccountThemeAction.bind(null, accountId)}
  >{children}</AccountTheme>;
}
