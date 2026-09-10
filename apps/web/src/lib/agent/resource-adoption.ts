import { z } from "zod";
import { videoVerificationSchema, type VideoVerification } from "../resources/verification";

export const resourceAdoptionCommandSchema = z.strictObject({ adoptionId: z.uuid(), sourceRunId: z.uuid(),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), replaceBindingId: z.uuid().nullable() });
export type ResourceAdoptionCommand = z.infer<typeof resourceAdoptionCommandSchema>;
const date = z.iso.datetime({ offset: true });
const rowSchema = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), source_run_id: z.uuid(), blueprint_id: z.uuid(),
  cleared_at: z.null().optional(),
  blueprint_version: z.int().nonnegative(), node_id: z.uuid(), video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  replace_binding_id: z.uuid().nullable(), new_binding_id: z.uuid(),
  status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "stale", "applied", "rejected"]),
  created_at: date, expires_at: date, verified_at: date.nullable(), valid_until: date.nullable(),
  result: videoVerificationSchema.nullable(), proposal_id: z.uuid().nullable(),
}).superRefine((row, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Inconsistent adoption receipt" });
  if (["queued", "running"].includes(row.status) !== (row.result === null)) invalid();
  if ((row.verified_at === null) !== (row.valid_until === null) || (row.proposal_id === null) !== (row.verified_at === null)) invalid();
  if (row.result?.status === "verified" && row.result.video.videoId !== row.video_id) invalid();
  if (["ready", "applied", "rejected"].includes(row.status) && (row.result?.status !== "verified" || row.proposal_id === null)) invalid();
  if (row.proposal_id !== null && row.result?.status !== "verified") invalid();
  if (row.verified_at && row.valid_until && Date.parse(row.valid_until) <= Date.parse(row.verified_at)) invalid();
  if (row.new_binding_id === row.replace_binding_id) invalid();
});
const clearedRowSchema = z.strictObject({ ...rowSchema.shape, status: z.literal("cleared"), cleared_at: date, video_id: z.null(), result: z.null() })
  .refine(row => (row.verified_at === null) === (row.valid_until === null) && (row.proposal_id === null) === (row.verified_at === null)
    && (row.valid_until === null || Date.parse(row.valid_until) > Date.parse(row.verified_at!)) && row.new_binding_id !== row.replace_binding_id,
  "Inconsistent cleared adoption receipt");
export function parseResourceAdoption(input: unknown, ownerId: string, id: string) {
  const row = z.union([rowSchema, clearedRowSchema]).parse(input);
  if (row.owner_id !== ownerId || row.id !== id) throw new Error("Unexpected adoption identity");
  return { id: row.id, ownerId: row.owner_id, sourceRunId: row.source_run_id, blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version,
    nodeId: row.node_id, videoId: row.video_id, replaceBindingId: row.replace_binding_id, newBindingId: row.new_binding_id,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at, verifiedAt: row.verified_at, validUntil: row.valid_until,
    result: row.result, proposalId: row.proposal_id, clearedAt: row.cleared_at ?? null };
}
export type ResourceAdoption = ReturnType<typeof parseResourceAdoption>;
type Receipt = { data: unknown; error: { code: string; message: string } | null };
export interface ResourceAdoptionWorker {
  claim(input: { adoptionId: string; leaseId: string }): Promise<Receipt>;
  finish(input: { adoptionId: string; leaseId: string; result: VideoVerification }): Promise<Receipt>;
}
