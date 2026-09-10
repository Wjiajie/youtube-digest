import { z } from "zod";
import { canonicalYouTubeUrl, type BlueprintSnapshot } from "./index";
import { NODE_TYPES } from "./node-types";

export const recordLearningNoteSchema = z.object({
  nodeId: z.uuid(), resourceBindingId: z.uuid(), expectedVersion: z.int().nonnegative(), clientMutationId: z.uuid(),
  text: z.string().max(16_000).refine(value => value.trim().length > 0 && Array.from(value).length <= 8000
    && !/[\u0000\uD800-\uDFFF]/u.test(value), "Note text must contain 1–8000 Unicode characters"),
  positionSeconds: z.int().nonnegative().max(2_147_483_647).nullable(),
}).strict();

export const learningNoteSchema = z.object({
  id: z.uuid(), clientMutationId: z.uuid(),
  context: z.object({
    blueprintId: z.uuid(), blueprintVersion: z.int().nonnegative(), goalId: z.uuid(), goalTitle: z.string(),
    stageId: z.uuid(), stageTitle: z.string(), nodeId: z.uuid(), nodeTitle: z.string(), nodeType: z.enum(NODE_TYPES),
  }),
  resource: z.object({ bindingId: z.uuid(), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), url: z.string() })
    .refine(resource => canonicalYouTubeUrl(resource.url)?.externalId === resource.videoId),
  // Read historical text without applying current writing limits or normalizing it.
  text: z.string(), positionSeconds: z.int().nonnegative().max(2_147_483_647).nullable(), createdAt: z.iso.datetime({ offset: true }),
});
export type LearningNote = z.infer<typeof learningNoteSchema>;
export type LearningNoteWorkspace = { blueprint: BlueprintSnapshot; records: LearningNote[] };
