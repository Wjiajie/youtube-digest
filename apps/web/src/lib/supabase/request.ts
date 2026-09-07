import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import type { Actor } from "@blueprint/domain";

import { extensionClientId, publicSupabaseConfig } from "../env";
import { createServerSupabase } from "./server";

export async function requestActor(request?: NextRequest): Promise<{
  actor: Actor;
  client: SupabaseClient<any, any, any, any, any>;
} | null> {
  const authorization = request?.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    const client = await createServerSupabase();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { actor: { userId: data.user.id, client: "web" }, client: client as SupabaseClient<any, any, any, any, any> };
  }

  const accessToken = authorization.slice("Bearer ".length);
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const claims = decodeJwtPayload(accessToken);
  const configuredClientId = extensionClientId();
  if (!configuredClientId || claims?.client_id !== configuredClientId) return null;
  return {
    actor: { userId: data.user.id, client: "extension" },
    client: client as SupabaseClient<any, any, any, any, any>,
  };
}

export async function extensionRequestActor(request: NextRequest) {
  const context = await requestActor(request);
  return context?.actor.client === "extension" ? context : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
