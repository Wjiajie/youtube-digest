import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { learningTranscriptRequestSchema, parseLearningTranscript } from "@blueprint/domain";
import { generateStructuredSkill } from "./structured-skill-generation";

const point = z.strictObject({ segmentIndex: z.int().min(0).max(19999), charOffset: z.int().min(0).max(20000) });
const inputSchema = z.strictObject({ generationId: z.uuid(), ownerId: z.uuid(), request: learningTranscriptRequestSchema,
  transcript: z.unknown(), selection: z.strictObject({ start: point, end: point }), question: z.string().max(1000).default(""),
  sourceReadStartedAt: z.number().nonnegative(), signal: z.instanceof(AbortSignal), expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const prose = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const outputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("explanation"), meaning: prose(2000), reasoning: prose(3000), background: prose(2000).nullable(),
    checkQuestion: prose(500).nullable(), limitations: z.array(prose(500)).max(3),
    evidence: z.array(z.strictObject({ segmentIndex: z.int().min(0).max(19999), quote: prose(300) })).min(1).max(3) }),
  z.strictObject({ kind: z.literal("insufficient_context"), reason: prose(1000), missingContext: z.array(prose(500)).min(1).max(3) }),
]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failure = <S extends string>(status: S) => ({ status, providerMayHaveRun: false, usage: null });
function splitsPair(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

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
    const first = selection.start.segmentIndex - page.offset, last = selection.end.segmentIndex - page.offset;
    if (first < 0 || last < first || last >= page.segments.length || last - first >= 5) return failure("invalid_input");
    const selected = [];
    const excerpts: { segmentIndex: number; startChar: number; text: string }[] = [];
    for (let index = Math.max(0, first - 1); index <= Math.min(page.segments.length - 1, last + 1); index++) {
      const segment = page.segments[index]!;
      const start = index === first ? selection.start.charOffset : 0;
      const end = index === last ? selection.end.charOffset : segment.text.length;
      if (index >= first && index <= last && (start > end || end > segment.text.length || splitsPair(segment.text, start) || splitsPair(segment.text, end)))
        return failure("invalid_input");
      if (index >= first && index <= last && start < end) selected.push({ segmentIndex: page.offset + index, startChar: start, endChar: end,
        text: segment.text.slice(start, end), offsetMs: segment.offsetMs, durationMs: segment.durationMs });
      let from = index < first ? Math.max(0, segment.text.length - 256) : index > last ? 0 : Math.max(0, start - 256);
      let to = index < first ? segment.text.length : index > last ? Math.min(segment.text.length, 256) : Math.min(segment.text.length, end + 256);
      if (splitsPair(segment.text, from)) from++;
      if (splitsPair(segment.text, to)) to--;
      excerpts.push({ segmentIndex: page.offset + index, startChar: from, text: segment.text.slice(from, to) });
    }
    const selectedText = selected.map(part => part.text).join("\n");
    if (!selectedText.trim() || selectedText.length > 2000) return failure("invalid_input");
    const source = { ownerId, bindingId: page.context.bindingId, nodeId: page.context.nodeId, videoId: page.context.videoId,
      sourceRunId: page.sourceRunId, sourceBlueprintVersion: page.sourceBlueprintVersion, sourceCreatedAt: page.sourceCreatedAt,
      contentExpiresAt: page.contentExpiresAt, language: page.language, offset: page.offset };
    const evidenceSha256 = hash({ source, selected, excerpts });
    const requestSha256 = hash({ evidenceSha256, question, targetLanguage: "zh-Hans" });
    const prompt = JSON.stringify({ sourceLanguage: page.language, targetLanguage: "zh-Hans", question,
      selected: selected.map(({ segmentIndex, startChar, endChar, text }) => ({ segmentIndex, startChar, endChar, text })), excerpts });
    if (Buffer.byteLength(prompt, "utf8") > 32 * 1024) return failure("invalid_input");
    let instructions: string;
    try { instructions = await readFile(new URL("./skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8"); }
    catch { return failure("unavailable"); }
    const skill = { name: "blueprint-explain-selection" as const, version: "1.0.0", sha256: createHash("sha256").update(instructions).digest("hex") };
    if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.sha256) return failure("unavailable");
    const remaining = deadline - performance.now();
    if (remaining <= 0) return failure("expired");
    const expiry = new AbortController(), timer = setTimeout(() => expiry.abort(), Math.min(remaining, 2_147_483_647));
    let result;
    try { result = await generateStructuredSkill({ model, instructions, prompt, schema: outputSchema, maxOutputTokens: 4096,
      signal: AbortSignal.any([signal, expiry.signal]) }); }
    finally { clearTimeout(timer); }
    const receipt = { providerMayHaveRun: result.providerMayHaveRun, usage: result.usage };
    if (signal.aborted) return { status: "cancelled" as const, ...receipt };
    if (expiry.signal.aborted || performance.now() >= deadline) return { status: "expired" as const, ...receipt };
    if (result.status !== "generated") return result;
    const answer = result.output;
    if (answer.kind === "explanation") {
      let selectedEvidence = false;
      const seen = new Set<string>();
      for (const item of answer.evidence) {
        const excerpt = excerpts.find(part => part.segmentIndex === item.segmentIndex), key = JSON.stringify(item);
        if (!excerpt || !excerpt.text.includes(item.quote) || seen.has(key)) return { status: "invalid_output" as const, ...receipt };
        seen.add(key);
        const target = selected.find(part => part.segmentIndex === item.segmentIndex);
        for (let at = excerpt.text.indexOf(item.quote); at >= 0; at = excerpt.text.indexOf(item.quote, at + 1)) {
          if (target) {
            const overlapStart = Math.max(target.startChar, excerpt.startChar + at);
            const overlapEnd = Math.min(target.endChar, excerpt.startChar + at + item.quote.length);
            if (overlapStart < overlapEnd && target.text.slice(overlapStart - target.startChar, overlapEnd - target.startChar).trim()) selectedEvidence = true;
          }
        }
      }
      if (!selectedEvidence) return { status: "invalid_output" as const, ...receipt };
    }
    return { status: answer.kind === "explanation" ? "explained" as const : "insufficient_context" as const,
      generationId, ...receipt, skill, source: { ...source, evidenceSha256 }, requestSha256, selected, answer };
  } };
}
