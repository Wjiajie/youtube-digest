import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { learningTranscriptRequestSchema, parseLearningTranscript } from "@blueprint/domain";
import { generateStructuredSkill } from "./structured-skill-generation";

const requestSchema = z.strictObject({ generationId: z.uuid(), ownerId: z.uuid(), targetLanguage: z.literal("zh-Hans"),
  request: learningTranscriptRequestSchema, transcript: z.unknown(), sourceReadStartedAt: z.number().nonnegative(),
  signal: z.instanceof(AbortSignal), expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const answerSchema = z.strictObject({ segments: z.array(z.strictObject({ segmentIndex: z.int().min(0).max(19999),
  translation: z.string().min(1).max(20000).refine(value => value.trim().length > 0) })).min(1).max(20) });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Internal inference only. The caller must authorize and persist a run before calling,
 * and persist its result under the original content deadline before exposing it. */
export function createTranscriptTranslator({ model }: { model: Exclude<LanguageModel, string> }) {
  return { async run(input: unknown) {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
    const { generationId, ownerId, request, targetLanguage, signal, sourceReadStartedAt } = parsed.data;
    if (request.sourceRunId === null || sourceReadStartedAt > performance.now())
      return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun: false, usage: null };
    let page;
    try { page = parseLearningTranscript(parsed.data.transcript, ownerId, request); }
    catch { return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null }; }
    if (page.status !== "ready" || page.segments.length === 0) return { status: "no_evidence" as const, providerMayHaveRun: false, usage: null };
    const deadline = sourceReadStartedAt + Date.parse(page.contentExpiresAt) - Date.parse(page.observedAt);
    if (performance.now() >= deadline) return { status: "expired" as const, providerMayHaveRun: false, usage: null };
    const source = { ownerId, bindingId: page.context.bindingId, nodeId: page.context.nodeId, videoId: page.context.videoId,
      sourceRunId: page.sourceRunId, sourceBlueprintVersion: page.sourceBlueprintVersion, sourceCreatedAt: page.sourceCreatedAt,
      contentExpiresAt: page.contentExpiresAt, language: page.language, offset: page.offset, totalSegments: page.totalSegments };
    const evidenceSha256 = sha256(JSON.stringify({ source, segments: page.segments }));
    const prompt = JSON.stringify({ sourceLanguage: page.language, targetLanguage,
      segments: page.segments.map((segment, index) => ({ segmentIndex: page.offset + index, text: segment.text })) });
    if (Buffer.byteLength(prompt, "utf8") > 64 * 1024) return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
    let instructions: string;
    try { instructions = await readFile(new URL("./skills/translate-transcript/v1/SKILL.md", import.meta.url), "utf8"); }
    catch { return { status: "unavailable" as const, providerMayHaveRun: false, usage: null }; }
    const skill = { name: "blueprint-translate-transcript" as const, version: "1.0.0", sha256: sha256(instructions) };
    if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.sha256)
      return { status: "unavailable" as const, providerMayHaveRun: false, usage: null };
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { status: "expired" as const, providerMayHaveRun: false, usage: null };
    const expiry = new AbortController();
    // The shared generation policy caps execution at 60 seconds; cap this timer
    // to its supported range without extending the original source deadline.
    const timer = setTimeout(() => expiry.abort(), Math.min(remaining, 2_147_483_647));
    let result;
    try {
      result = await generateStructuredSkill({ model, instructions, prompt, schema: answerSchema, maxOutputTokens: 8192,
        signal: AbortSignal.any([signal, expiry.signal]) });
    } finally { clearTimeout(timer); }
    if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage };
    if (expiry.signal.aborted || performance.now() >= deadline)
      return { status: "expired" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage };
    if (result.status !== "generated") return result;
    if (result.output.segments.length !== page.segments.length || result.output.segments.some((segment, index) => segment.segmentIndex !== page.offset + index))
      return { status: "invalid_output" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage };
    return { status: "translated" as const, generationId, targetLanguage, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage, skill,
      source: { ...source, evidenceSha256 },
      segments: page.segments.map((segment, index) => ({ ...segment, ...result.output.segments[index] })),
    };
  } };
}
