import { z } from "zod";
import type { LanguageModel } from "ai";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import { createHash } from "node:crypto";
import { loadResourceMatchingSkill } from "./resource-matching-skill";
import { generateStructuredSkill, type SkillUsage } from "./structured-skill-generation";

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/);
const candidateSchema = z.object({
  video: z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: text(1000), description: z.string().max(20000),
    publishedAt: z.iso.datetime({ offset: true }), durationSeconds: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  transcript: z.discriminatedUnion("status", [z.object({ status: z.literal("ready"), language,
    segments: z.array(z.object({ text: text(20000), offset: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER), duration: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER) })
      .refine(segment => segment.offset + segment.duration <= Number.MAX_SAFE_INTEGER)).min(1).max(20000) }),
    z.object({ status: z.enum(["pending", "not_found", "invalid_input", "unavailable", "cancelled", "timed_out", "rate_limited"]) })]),
  eligibleForMatching: z.boolean(), languageFallback: z.boolean().nullable(), matching: z.literal("not_evaluated"),
});

const requestSchema = z.strictObject({
  blueprint: blueprintSnapshotSchema, nodeId: z.uuid(), signal: z.instanceof(AbortSignal),
  learnerContext: z.strictObject({ startingPoint: z.string().max(2000).nullable(), constraints: z.string().max(2000).nullable() }),
  discovery: z.object({ status: z.literal("discovered"),
    source: z.strictObject({ blueprintId: z.uuid(), blueprintVersion: z.int().nonnegative(), nodeId: z.uuid(), checkedAt: z.iso.datetime({ offset: true }) }),
    candidates: z.array(candidateSchema).max(3).refine(candidates => new Set(candidates.map(candidate => candidate.video.videoId)).size === candidates.length),
  }),
  expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
// This is an output-contract guard, not a substitute for safe rendering in a future UI.
const linkSyntax = /(?:[a-z][a-z\d+.-]*:\/\/|\/\/[a-z\d]|www\.|(?:javascript|data|mailto):|\[[^\]]*\]\s*(?:\(|\[|:)|<\s*a\b)/i;
const prose = (max: number) => text(max).refine(value => !linkSyntax.test(value));
const answerSchema = z.strictObject({ summary: prose(600), assessments: z.array(z.strictObject({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), role: z.enum(["recommended", "alternative", "rejected"]),
  relevance: prose(400), levelFit: prose(400), languageFit: prose(400), timeFit: prose(400), freshness: prose(400),
  limitations: z.array(prose(240)).max(3),
  evidence: z.array(z.strictObject({ segmentIndex: z.int().nonnegative(), quote: prose(200) })).min(1).max(2),
})).max(3) });
const excerptText = (value: string, limit: number) => [...value].slice(0, limit).join("");

/** Internal review suggestions only; the caller must authorize the current snapshot and discovery. */
export function createResourceMatcher(dependencies: { model: Exclude<LanguageModel, string> }) {
  return { async run(input: unknown) {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
    const { blueprint, nodeId, discovery, signal, learnerContext } = parsed.data;
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun: false, usage: null };
    const node = blueprint.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes)).find(node => node.id === nodeId);
    if (!node || node.type !== "learn" || discovery.source.blueprintId !== blueprint.id || discovery.source.blueprintVersion !== blueprint.version || discovery.source.nodeId !== nodeId) {
      return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
    }
    let providerMayHaveRun = false;
    let usage: SkillUsage | null = null;
    try {
      const candidates = discovery.candidates.flatMap(candidate => {
        if (!candidate.eligibleForMatching || candidate.transcript.status !== "ready") return [];
        const segments = candidate.transcript.segments;
        const count = Math.min(24, segments.length);
        const excerpts = Array.from({ length: count }, (_, index) => {
          const segmentIndex = count === 1 ? 0 : Math.floor(index * (segments.length - 1) / (count - 1));
          const segment = segments[segmentIndex];
          return { segmentIndex, offsetMs: segment.offset, durationMs: segment.duration, text: excerptText(segment.text, 320) };
        });
        return [{ ...candidate.video, title: excerptText(candidate.video.title, 240), description: excerptText(candidate.video.description, 1200),
          captionLanguage: candidate.transcript.language, languageFallback: candidate.languageFallback,
          coverage: { totalSegments: segments.length, sampledSegments: excerpts.length, textTruncated: excerpts.some(segment => segment.text !== segments[segment.segmentIndex].text) },
          excerpts,
        }];
      });
      if (!candidates.length) return { status: "no_evidence" as const, providerMayHaveRun, usage };
      const prompt = JSON.stringify({ node: { title: node.title, description: node.description ?? "", estimatedMinutes: node.estimatedMinutes ?? null,
        completionCriteria: node.completionCriteria ?? null }, learnerContext, candidates });
      if (Buffer.byteLength(prompt, "utf8") > 96 * 1024) return { status: "invalid_input" as const, providerMayHaveRun, usage };
      const skill = await loadResourceMatchingSkill();
      if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.identity.sha256) {
        return { status: "unavailable" as const, providerMayHaveRun, usage };
      }
      const result = await generateStructuredSkill({ model: dependencies.model, instructions: skill.instructions,
        schema: answerSchema, maxOutputTokens: 8192, signal, prompt });
      if (result.status !== "generated") return result;
      providerMayHaveRun = result.providerMayHaveRun; usage = result.usage;
      const selected = result.output.assessments;
      const recommended = selected.filter(item => item.role === "recommended").length;
      const alternatives = selected.filter(item => item.role === "alternative").length;
      if (selected.length !== candidates.length || new Set(selected.map(item => item.videoId)).size !== selected.length ||
        recommended > 1 || alternatives > 2 || (alternatives > 0 && recommended !== 1)) {
        return { status: "invalid_output" as const, providerMayHaveRun, usage };
      }
      const assessments = [];
      for (const assessment of selected) {
        const candidate = candidates.find(candidate => candidate.videoId === assessment.videoId);
        if (!candidate || new Set(assessment.evidence.map(item => item.segmentIndex)).size !== assessment.evidence.length) {
          return { status: "invalid_output" as const, providerMayHaveRun, usage };
        }
        const evidence = [];
        for (const citation of assessment.evidence) {
          const segment = candidate.excerpts.find(segment => segment.segmentIndex === citation.segmentIndex);
          if (!segment || !segment.text.includes(citation.quote)) return { status: "invalid_output" as const, providerMayHaveRun, usage };
          evidence.push({ ...citation, offsetMs: segment.offsetMs });
        }
        assessments.push({ ...assessment, evidence });
      }
      return { status: recommended ? "matched" as const : "no_match" as const, reviewRequired: true as const, providerMayHaveRun: true, usage,
        source: { ...discovery.source, evidenceSha256: createHash("sha256").update(prompt).digest("hex") },
        skill: skill.identity, summary: result.output.summary, assessments,
        coverage: candidates.map(candidate => ({ videoId: candidate.videoId, ...candidate.coverage })),
      };
    } catch {
      return { status: signal.aborted ? "cancelled" as const : "unavailable" as const, providerMayHaveRun, usage };
    }
  } };
}
