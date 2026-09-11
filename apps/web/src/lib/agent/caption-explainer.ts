import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { learningTranscriptRequestSchema, parseLearningTranscript } from "@blueprint/domain";
import { generateStructuredSkill } from "./structured-skill-generation";
import { explanationAnswerMatches, explanationAnswerSchema, explanationEvidence, explanationSelectionSchema } from "./explanation-evidence";

const inputSchema = z.strictObject({ generationId: z.uuid(), ownerId: z.uuid(), request: learningTranscriptRequestSchema,
  transcript: z.unknown(), selection: explanationSelectionSchema, question: z.string().max(1000).default(""),
  sourceReadStartedAt: z.number().nonnegative(), signal: z.instanceof(AbortSignal), expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const failure = <S extends string>(status: S) => ({ status, providerMayHaveRun: false, usage: null });

/** Internal inference seam: caller must authorize and reserve a private run before
 * invoking, then persist under its original source deadline before exposing results. */
export function createCaptionExplainer({ model }: { model: Exclude<LanguageModel, string> }) {
  return { async run(input: unknown) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return failure("invalid_input");
    const { generationId, ownerId, request, selection, question, sourceReadStartedAt, signal } = parsed.data;
    if (!request.sourceRunId || sourceReadStartedAt > performance.now()) return failure("invalid_input");
    if (signal.aborted) return failure("cancelled");
    let page;
    try { page = parseLearningTranscript(parsed.data.transcript, ownerId, request); }
    catch { return failure("invalid_input"); }
    if (page.status !== "ready" || !page.segments.length) return failure("no_evidence");
    const deadline = sourceReadStartedAt + Date.parse(page.contentExpiresAt) - Date.parse(page.observedAt);
    if (performance.now() >= deadline) return failure("expired");
    let evidence;
    try { evidence = explanationEvidence(page, selection, question); }
    catch { return failure("invalid_input"); }
    const { source, requestSha256, selected, prompt } = evidence;
    let instructions: string;
    try { instructions = await readFile(new URL("./skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8"); }
    catch { return failure("unavailable"); }
    const skill = { name: "blueprint-explain-selection" as const, version: "1.0.0", sha256: createHash("sha256").update(instructions).digest("hex") };
    if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.sha256) return failure("unavailable");
    const remaining = deadline - performance.now();
    if (remaining <= 0) return failure("expired");
    const expiry = new AbortController(), timer = setTimeout(() => expiry.abort(), Math.min(remaining, 2_147_483_647));
    let result;
    try { result = await generateStructuredSkill({ model, instructions, prompt, schema: explanationAnswerSchema, maxOutputTokens: 4096,
      signal: AbortSignal.any([signal, expiry.signal]) }); }
    finally { clearTimeout(timer); }
    const receipt = { providerMayHaveRun: result.providerMayHaveRun, usage: result.usage };
    if (signal.aborted) return { status: "cancelled" as const, ...receipt };
    if (expiry.signal.aborted || performance.now() >= deadline) return { status: "expired" as const, ...receipt };
    if (result.status !== "generated") return result;
    const answer = result.output;
    if (!explanationAnswerMatches(answer, evidence)) return { status: "invalid_output" as const, ...receipt };
    return { status: answer.kind === "explanation" ? "explained" as const : "insufficient_context" as const,
      generationId, ...receipt, skill, source, requestSha256, selected, answer };
  } };
}
