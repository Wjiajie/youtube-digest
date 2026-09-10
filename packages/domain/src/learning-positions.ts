import { z } from "zod";
import { canonicalYouTubeUrl, parseCurrentBlueprintSnapshot, type BlueprintSnapshot } from "./index";
import { NODE_TYPES } from "./node-types";

const commandId = z.uuid().transform(value => value.toLowerCase());
const nonnegativeInteger = z.int().nonnegative().max(2_147_483_647);
export const learningPositionBindingFilterSchema = commandId.optional();
export const recordLearningPositionSchema = z.object({
  nodeId: commandId, resourceBindingId: commandId, clientMutationId: commandId,
  expectedVersion: nonnegativeInteger, expectedPositionVersion: nonnegativeInteger.max(2_147_483_646),
  positionSeconds: nonnegativeInteger,
}).strict();

export const learningPositionSchema = z.object({
  id: z.uuid(), clientMutationId: z.uuid(),
  context: z.object({
    blueprintId: z.uuid(), blueprintVersion: nonnegativeInteger, goalId: z.uuid(), goalTitle: z.string(),
    stageId: z.uuid(), stageTitle: z.string(), nodeId: z.uuid(), nodeTitle: z.string(), nodeType: z.enum(NODE_TYPES),
  }).strict(),
  resource: z.object({ bindingId: z.uuid(), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), url: z.string() }).strict()
    .refine(resource => {
      const canonical = canonicalYouTubeUrl(resource.url);
      return canonical?.externalId === resource.videoId && canonical.url === resource.url;
    }),
  positionSeconds: nonnegativeInteger, expectedPositionVersion: nonnegativeInteger.max(2_147_483_646),
  positionVersion: nonnegativeInteger.min(1), createdAt: z.iso.datetime({ offset: true }),
}).strict().refine(record => record.positionVersion === record.expectedPositionVersion + 1);
export type LearningPosition = z.infer<typeof learningPositionSchema>;
export type LearningPositionWorkspace = { blueprint: BlueprintSnapshot; records: LearningPosition[] };

export function parseLearningPositionWorkspace(input: unknown): LearningPositionWorkspace {
  const envelope = z.object({ blueprint: z.unknown(), records: learningPositionSchema.array().max(50) }).strict().parse(input);
  const blueprint = parseCurrentBlueprintSnapshot(envelope.blueprint);
  const ids = new Set<string>(), mutations = new Set<string>(), bindings = new Set<string>();
  for (const record of envelope.records) {
    if (record.context.blueprintId !== blueprint.id || record.context.blueprintVersion > blueprint.version
      || ids.has(record.id) || mutations.has(record.clientMutationId) || bindings.has(record.resource.bindingId)) throw new Error("Invalid position workspace");
    ids.add(record.id); mutations.add(record.clientMutationId); bindings.add(record.resource.bindingId);
  }
  return { blueprint, records: envelope.records };
}
