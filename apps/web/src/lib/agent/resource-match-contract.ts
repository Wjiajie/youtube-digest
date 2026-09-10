import { z } from "zod";
import { resourceSourceSchema } from "../resources/evidence";
import { planningUsageSchema } from "./planning-result";

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
// Output contract only, not a substitute for safe rendering in the future UI.
const linkSyntax = /(?:[a-z][a-z\d+.-]*:\/\/|\/\/[a-z\d]|www\.|(?:javascript|data|mailto):|\[[^\]]*\]\s*(?:\(|\[|:)|<\s*a\b)/i;
const prose = (max: number) => text(max).refine(value => !linkSyntax.test(value));
const citation = z.strictObject({ segmentIndex: z.int().nonnegative(), quote: prose(200) });
const assessment = z.strictObject({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), role: z.enum(["recommended", "alternative", "rejected"]),
  relevance: prose(400), levelFit: prose(400), languageFit: prose(400), timeFit: prose(400), freshness: prose(400),
  limitations: z.array(prose(240)).max(3), evidence: z.array(citation).min(1).max(2),
});
export const resourceAnswerSchema = z.strictObject({ summary: prose(600), assessments: z.array(assessment).max(3) });
export const resourceSkillIdentitySchema = z.strictObject({ name: z.literal("blueprint-match-resources"), version: z.string().max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const resourceSkillSchema = resourceSkillIdentitySchema.extend({ instructions: z.string().min(1).max(32000) });
export const matchedResourcesSchema = resourceAnswerSchema.extend({
  status: z.enum(["matched", "no_match"]), reviewRequired: z.literal(true), providerMayHaveRun: z.literal(true), usage: planningUsageSchema,
  source: resourceSourceSchema.extend({ evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }), skill: resourceSkillIdentitySchema,
  assessments: z.array(assessment.extend({ evidence: z.array(citation.extend({ offsetMs: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER) })).min(1).max(2) })).min(1).max(3),
  coverage: z.array(z.strictObject({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), totalSegments: z.int().positive(), sampledSegments: z.int().min(1).max(24), textTruncated: z.boolean() })).min(1).max(3),
});
