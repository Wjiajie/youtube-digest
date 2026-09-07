import { createBlueprintApplication } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseBlueprintStore } from "./supabase/store";

export function blueprintApplication(client: SupabaseClient<any, any, any, any, any>) {
  return createBlueprintApplication({
    store: createSupabaseBlueprintStore(client),
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
  });
}
