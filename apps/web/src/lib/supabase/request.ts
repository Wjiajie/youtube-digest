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

export function authFailure(error: { status?: number }): Extract<RequestActorResult, { ok: false }> {
  const invalidSession = error.status !== undefined && [400, 401, 403, 422].includes(error.status);
  return { ok: false, code: invalidSession ? "unauthenticated" : "unavailable" };
}

export async function resolveExtensionRequestActor(request: NextRequest): Promise<RequestActorResult> {
  const context = await resolveRequestActor(request);
  if (!context.ok) return context;
  return context.value.actor.client === "extension"
    ? context
    : { ok: false, code: "unauthenticated" };
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
