import { redirect } from "next/navigation";
import { CompanionSettings } from "@/components/companion/companion-settings";
import { preferences } from "@/lib/companion/store";
import { resolveRequestActor } from "@/lib/supabase/request";
import { AuthUnavailable } from "../../auth-unavailable";
import { localCompanionMode } from "@/lib/companion/local-config";
export default async function CompanionSettingsPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable")
      return <AuthUnavailable retryPath="/settings/companion" />;
    redirect("/preview");
  }
  try {
    const saved = await preferences(
      identity.value.client,
      identity.value.actor,
    );
    return (
      <CompanionSettings
        local={localCompanionMode()}
        initial={saved.value}
        initialRevision={saved.revision}
      />
    );
  } catch {
    return <AuthUnavailable retryPath="/settings/companion" />;
  }
}
