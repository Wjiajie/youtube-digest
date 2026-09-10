import type { ApplicationResult } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";

type Auth = ReturnType<typeof createExtensionAuthPort>;
type Session = NonNullable<Awaited<ReturnType<Auth["accessToken"]>>>;

// Shared by the evidence and explicit assessment adapters. This module alone
// classifies authenticated HTTP errors; neither caller automatically retries writes.
export function createAuthenticatedTransport(auth: Auth, apiBase: string) {
  async function authorize(ownerId: unknown): Promise<ApplicationResult<Session>> {
    const current = await auth.accessToken();
    if (!current) return { ok: false, code: "unauthenticated" };
    return current.session.userId === ownerId ? { ok: true, value: current } : { ok: false, code: "forbidden" };
  }

  async function request<T>(session: Session, path: string, parse: (input: unknown) => T, input?: unknown): Promise<ApplicationResult<T>> {
    try {
      if (!await auth.isCurrent(session.token)) return { ok: false, code: "forbidden" };
      const response = await fetch(`${apiBase}/api/v1/${path}`, {
        method: input === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${session.token}`, "content-type": "application/json" },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!await auth.isCurrent(session.token)) return { ok: false, code: "forbidden" };
      const body: unknown = await response.json();
      if (!await auth.isCurrent(session.token)) return { ok: false, code: "forbidden" };
      if (response.status === 401 && typeof body === "object" && body !== null && "code" in body && body.code === "unauthenticated") {
        await auth.invalidate(session.token);
        return { ok: false, code: "unauthenticated" };
      }
      if (response.ok) return { ok: true, value: parse(body) };
      const code = { 403: "forbidden", 404: "not_found", 409: "version_conflict", 422: "invalid" }[response.status] as
        "forbidden" | "not_found" | "version_conflict" | "invalid" | undefined;
      // A gateway's generic error must never be mistaken for a definitive
      // rejected mutation; only the application's matching error is final.
      if (code && typeof body === "object" && body !== null && "code" in body && body.code === code) return { ok: false, code };
      return { ok: false, code: "unavailable" };
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }

  return { authorize, request };
}
