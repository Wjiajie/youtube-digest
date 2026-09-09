import { z } from "zod";
import type { BlueprintSnapshot } from "./index";
import type { ApplicationResult } from "./application";
import { progressEvidenceSchema, type ProgressEvidence } from "./progress-evidence";

export const NODE_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const confirmNodeStatusSchema = z.object({
  nodeId: z.uuid(),
  expectedVersion: z.int().nonnegative().max(2_147_483_647),
  expectedStatusRevision: z.int().nonnegative().max(2_147_483_646),
  status: z.enum(NODE_STATUSES),
  evidenceId: z.uuid().nullable().optional(),
  clientMutationId: z.uuid(),
}).strict().refine(value => !value.evidenceId || value.status === "completed", {
  message: "Only a completion confirmation may reference evidence", path: ["evidenceId"],
});

export type ConfirmNodeStatus = z.infer<typeof confirmNodeStatusSchema>;

// Read immutable historical context without current form normalization.
export const nodeStatusRecordSchema = z.object({
  id: z.uuid(), clientMutationId: z.uuid(),
  context: progressEvidenceSchema.shape.context,
  estimatedMinutes: z.int().positive().nullable(), completionCriteria: z.string(),
  status: z.enum(NODE_STATUSES), revision: z.int().positive(), evidenceId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NodeStatusRecord = z.infer<typeof nodeStatusRecordSchema>;
export type NodeStatusWorkspace = {
  blueprint: BlueprintSnapshot;
  current: NodeStatusRecord[];
  history: NodeStatusRecord[];
  evidence: ApplicationResult<ProgressEvidence[]>;
};
