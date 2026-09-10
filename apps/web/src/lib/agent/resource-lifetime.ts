import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
export const resourceLifetimeFields = {
  source_started_at: instant.nullable().default(null),
  content_expires_at: instant.nullable().default(null),
  retention_policy_ref: z.string().trim().min(1).max(200).nullable().default(null),
  clear_reason: z.enum(["manual", "expired"]).nullable().default(null),
};
const lifetime = z.object(resourceLifetimeFields);
/** Legacy bodies have no trusted lifetime; only already-sanitized receipts survive. */
export function readResourceLifetime(row: z.infer<typeof lifetime> & { status: string; cleared_at?: string | null }) {
  const empty = row.source_started_at === null && row.content_expires_at === null && row.retention_policy_ref === null;
  const complete = row.source_started_at !== null && row.content_expires_at !== null && row.retention_policy_ref !== null
    && Date.parse(row.source_started_at) < Date.parse(row.content_expires_at);
  if (!complete && !(empty && row.status === "cleared" && row.clear_reason !== "expired")) throw new Error("Untrusted resource lifetime");
  if (row.status !== "cleared" && row.clear_reason !== null) throw new Error("Unexpected clearing reason");
  if (row.clear_reason === "expired" && (!row.cleared_at || !row.content_expires_at || Date.parse(row.cleared_at) < Date.parse(row.content_expires_at))) {
    throw new Error("Premature expiry receipt");
  }
  return { sourceStartedAt: row.source_started_at, contentExpiresAt: row.content_expires_at, retentionPolicyRef: row.retention_policy_ref,
    clearReason: row.status === "cleared" ? row.clear_reason ?? "manual" : null };
}

/** The worker lease and original evidence deadline both bound outbound processing. */
export function resourceExecutionSignal(record: { expiresAt: string; contentExpiresAt: string | null }, parent: AbortSignal): AbortSignal {
  const remaining = record.contentExpiresAt === null ? NaN : Math.min(Date.parse(record.expiresAt), Date.parse(record.contentExpiresAt)) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return AbortSignal.abort(new DOMException("Evidence deadline elapsed", "TimeoutError"));
  return AbortSignal.any([parent, AbortSignal.timeout(Math.min(Math.floor(remaining), 2_147_483_647))]);
}
