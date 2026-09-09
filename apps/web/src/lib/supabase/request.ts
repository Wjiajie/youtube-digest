import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import type { Actor } from "@blueprint/domain";

import { extensionClientId, publicSupabaseConfig } from "../env";
import { createServerSupabase } from "./server";

type RequestActorContext = {
  actor: Actor;
  client: SupabaseClient<any, any, any, any, any>;
};

type RequestActorResult =
  | { ok: true; value: RequestActorContext }
  | { ok: false; code: "unauthenticated" | "unavailable" };

// Preserve the existing nullable contract for M1 callers. New recovery-aware
// surfaces use the result contract instead of treating an outage as a logout.
export async function requestActor(request?: NextRequest): Promise<RequestActorContext | null> {
  const result = await resolveRequestActor(request);
  return result.ok ? result.value : null;
}

export async function resolveRequestActor(request?: NextRequest): Promise<RequestActorResult> {
  const authorization = request?.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    const client = await createServerSupabase();
    const { data, error } = await client.auth.getUser();
    if (error) return authFailure(error);
    if (!data.user) return { ok: false, code: "unauthenticated" };
    return { ok: true, value: { actor: { userId: data.user.id, client: "web" }, client: client as SupabaseClient<any, any, any, any, any> } };
  }

  const accessToken = authorization.slice("Bearer ".length);
  const { url, publishableKey } = publicSupabaseConfig();
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error) return authFailure(error);
  if (!data.user) return { ok: false, code: "unauthenticated" };
  const claims = decodeJwtPayload(accessToken);
  const configuredClientId = extensionClientId();
  if (!configuredClientId || claims?.client_id !== configuredClientId) return { ok: false, code: "unauthenticated" };
  return {
    ok: true,
    value: {
      actor: { userId: data.user.id, client: "extension" },
      client: client as SupabaseClient<any, any, any, any, any>,
    },
  };
}

function authFailure(error: { status?: number }): RequestActorResult {
  const invalidSession = error.status !== undefined && [400, 401, 403, 422].includes(error.status);
  return { ok: false, code: invalidSession ? "unauthenticated" : "unavailable" };
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
