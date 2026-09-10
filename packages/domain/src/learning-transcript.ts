import { z } from "zod";

const id = z.uuid().transform(value => value.toLowerCase());
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const instant = z.iso.datetime({ offset: true });
export const learningTranscriptRequestSchema = z.strictObject({
  bindingId: id, videoId, sourceRunId: id.nullable().default(null), offset: z.int().min(0).max(19999).multipleOf(20).default(0),
}).refine(value => value.offset === 0 || value.sourceRunId !== null);
export type LearningTranscriptRequest = z.infer<typeof learningTranscriptRequestSchema>;

const common = {
  ownerId: z.uuid(), context: z.strictObject({ bindingId: z.uuid(), nodeId: z.uuid(), nodeTitle: z.string().max(2000),
    goalId: z.uuid(), goalTitle: z.string().max(2000), videoId }), observedAt: instant,
};
const milliseconds = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const transcriptSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...common, status: z.literal("unavailable"), reason: z.enum(["not_acquired", "pending", "not_available", "expired", "cleared"]) }),
  z.strictObject({ ...common, status: z.literal("ready"), sourceRunId: z.uuid(), sourceBlueprintVersion: z.int().nonnegative(),
    sourceCreatedAt: instant, contentExpiresAt: instant, title: z.string().min(1).max(1000),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/), offset: z.int().min(0).max(19999).multipleOf(20),
    totalSegments: z.int().min(1).max(20000), segments: z.array(z.strictObject({ text: z.string().min(1).max(20000),
      offsetMs: milliseconds, durationMs: milliseconds })).max(20),
  }),
]);
export type LearningTranscript = z.infer<typeof transcriptSchema>;

/** One bounded video page; never accept a different account, binding or pinned source. */
export function parseLearningTranscript(input: unknown, ownerId: string, request: unknown): LearningTranscript {
  const command = learningTranscriptRequestSchema.parse(request);
  const result = transcriptSchema.parse(input);
  if (result.ownerId !== ownerId || result.context.bindingId !== command.bindingId || result.context.videoId !== command.videoId)
    throw new Error("Invalid transcript identity");
  if (result.status === "ready" && (result.offset !== command.offset || command.sourceRunId !== null && result.sourceRunId !== command.sourceRunId))
    throw new Error("Invalid transcript source");
  if (result.status === "ready" && (Date.parse(result.sourceCreatedAt) > Date.parse(result.observedAt)
    || Date.parse(result.contentExpiresAt) <= Date.parse(result.observedAt)
    || result.segments.length !== Math.min(20, Math.max(0, result.totalSegments - result.offset))
    || result.segments.some(segment => segment.text.trim().length === 0 || segment.offsetMs + segment.durationMs > Number.MAX_SAFE_INTEGER)))
    throw new Error("Invalid transcript page");
  return result;
}
