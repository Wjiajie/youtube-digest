import { redirect } from "next/navigation";
import { readNodeStatusWorkspace } from "@/lib/node-status";
import { recordProductEvent } from "@/lib/product-events";
import { resolveRequestActor } from "@/lib/supabase/request";

import { AuthUnavailable } from "./auth-unavailable";
import { CompanionHome } from "@/components/companion/companion-home";
import { localCompanionMode } from "@/lib/companion/local-config";

export default async function HomePage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable")
      return <AuthUnavailable retryPath="/" />;
    redirect("/preview");
  }
  const { actor, client } = identity.value;
  const result = await readNodeStatusWorkspace(client, actor).catch(() => ({
    ok: false as const,
    code: "unavailable" as const,
  }));
  if (result.ok)
    await recordProductEvent(client, actor, "blueprint_viewed", {
      entityType: "blueprint",
      entityId: result.value.blueprint.id,
    });
  return <CompanionHome key={actor.userId} local={localCompanionMode()} />;
}
