import { z } from "zod";
import { NODE_TYPES } from "./node-types";

const artifactUrlSchema = z.string().max(2048).url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return value.startsWith("https://") && url.protocol === "https:" && !url.username && !url.password
    && !/[\s\\]/u.test(value);
});
const evidenceTextSchema = z.string().trim().min(1).max(8000);

export const recordProgressEvidenceSchema = z.object({
  nodeId: z.uuid(),
  expectedVersion: z.int().nonnegative(),
  clientMutationId: z.uuid(),
  text: evidenceTextSchema,
  artifactUrl: artifactUrlSchema.nullable().optional(),
}).strict();

// Evidence is independent of a BlueprintSnapshot and never implies completion.
export const progressEvidenceSchema = z.object({
  id: z.uuid(),
  clientMutationId: z.uuid(),
  context: z.object({
    blueprintId: z.uuid(), blueprintVersion: z.int().nonnegative(),
    goalId: z.uuid(), goalTitle: z.string(), stageId: z.uuid(), stageTitle: z.string(),
    nodeId: z.uuid(), nodeTitle: z.string(), nodeType: z.enum(NODE_TYPES),
  }),
  // Read historical data without trimming it or reapplying current form limits.
  // Consumers validate URLs before making them clickable; no link is verified
  // as reachable, public or trustworthy simply because it is stored here.
  text: z.string(),
  artifactUrl: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ProgressEvidence = z.infer<typeof progressEvidenceSchema>;
