import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { z } from "zod";
import { extensionClientId, publicSupabaseConfig } from "../env";
import { createServerSupabase } from "../supabase/server";
import { authFailure } from "../supabase/request";

export type ExplanationTransport = "web" | "extension";
type Identity = { ok: true; value: { actor: Actor; client: SupabaseClient; accessToken: string } }
  | { ok: false; code: "unauthenticated" | "unavailable" | "forbidden" };
const uuid = z.uuid();
const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** No transport fallback: Cookie identity and the extension grant are distinct. */
export function explanationTransportFailure(request: Request, transport: ExplanationTransport, write: boolean): Extract<Identity, { ok: false }> | null {
  if (transport === "extension") return bearer.test(request.headers.get("authorization") ?? "") ? null : { ok: false, code: "unauthenticated" };
  const origin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  return request.headers.has("authorization") || write && request.headers.get("origin") !== origin
    ? { ok: false, code: "forbidden" } : null;
}

/** The deadline cancels underlying Auth fetches as well as waiting on SDK work.
 * After verification, persistence uses the exact verified token, not a later
 * Cookie refresh and not the short-lived Auth signal. */
export async function explanationIdentity(request: Request, transport: ExplanationTransport, signal: AbortSignal): Promise<Identity> {
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException("Identity deadline", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const resolve = async (): Promise<Identity> => {
    signal.throwIfAborted();
    const denied = explanationTransportFailure(request, transport, false);
    if (denied) return denied;
    const { url, publishableKey } = publicSupabaseConfig();
    const configuredClientId = extensionClientId();
    if (transport === "extension" && (!configuredClientId || configuredClientId.trim() !== configuredClientId))
      return { ok: false, code: "unauthenticated" };
    const verifier = transport === "web" ? await createServerSupabase(signal) : createClient(url, publishableKey, {
      auth: authOptions,
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store",
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) },
    });
    let token = bearer.exec(request.headers.get("authorization") ?? "")?.[1];
    if (transport === "web") {
      const session = await verifier.auth.getSession();
      if (session.error) return authFailure(session.error);
      token = session.data.session?.access_token;
    }
    signal.throwIfAborted();
    if (!token) return { ok: false, code: "unauthenticated" };
    const [verified, current] = await Promise.all([verifier.auth.getClaims(token), verifier.auth.getUser(token)]);
    signal.throwIfAborted();
    const failures = [verified.error, current.error].filter(error => error !== null).map(error => authFailure(error));
    if (failures.length) return failures.find(failure => failure.code === "unavailable") ?? failures[0];
    const claims = verified.data?.claims, user = current.data.user;
    if (!claims || !user || !uuid.safeParse(claims.sub).success || claims.sub !== user.id
      || claims.role !== "authenticated" || user.role !== "authenticated" || claims.is_anonymous !== false || user.is_anonymous !== false
      || !uuid.safeParse(claims.session_id).success || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000)
      return { ok: false, code: "unauthenticated" };
    if (transport === "web" && Object.hasOwn(claims, "client_id")) return { ok: false, code: "forbidden" };
    if (transport === "extension" && claims.client_id !== configuredClientId) return { ok: false, code: "unauthenticated" };
    return { ok: true, value: { actor: { userId: user.id, client: transport }, accessToken: token,
      client: createClient(url, publishableKey, { auth: authOptions, global: { headers: { Authorization: `Bearer ${token}` } } }) } };
  };
  try { return await Promise.race([resolve(), aborted]); }
  catch { return { ok: false, code: "unavailable" }; }
  finally { signal.removeEventListener("abort", onAbort); }
}
