import { createHash } from "node:crypto";
import { z } from "zod";
import type { parseLearningTranscript } from "@blueprint/domain";

const point = z.strictObject({ segmentIndex: z.int().min(0).max(19999), charOffset: z.int().min(0).max(20000) });
export const explanationSelectionSchema = z.strictObject({ start: point, end: point });
const prose = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && value.isWellFormed() && !value.includes("\0"));
export const explanationAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("explanation"), meaning: prose(2000), reasoning: prose(3000), background: prose(2000).nullable(),
    checkQuestion: prose(500).nullable(), limitations: z.array(prose(500)).max(3),
    evidence: z.array(z.strictObject({ segmentIndex: z.int().min(0).max(19999), quote: prose(300) })).min(1).max(3) }),
  z.strictObject({ kind: z.literal("insufficient_context"), reason: prose(1000), missingContext: z.array(prose(500)).min(1).max(3) }),
]);
type Page = Extract<ReturnType<typeof parseLearningTranscript>, { status: "ready" }>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function splitsPair(text: string, offset: number) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

/** Shared by inference and recovery: rebuild evidence only from an authorized,
 * parsed source page. Browser text, model quotations and hashes are never inputs. */
export function explanationEvidence(page: Page, selection: z.infer<typeof explanationSelectionSchema>, question: string) {
  const first = selection.start.segmentIndex - page.offset, last = selection.end.segmentIndex - page.offset;
  if (first < 0 || last < first || last >= page.segments.length || last - first >= 5) throw new Error("Invalid explanation selection");
  const selected = [];
  const excerpts: { segmentIndex: number; startChar: number; text: string }[] = [];
  for (let index = Math.max(0, first - 1); index <= Math.min(page.segments.length - 1, last + 1); index++) {
    const segment = page.segments[index]!;
    const start = index === first ? selection.start.charOffset : 0;
    const end = index === last ? selection.end.charOffset : segment.text.length;
    if (index >= first && index <= last && (start > end || end > segment.text.length || splitsPair(segment.text, start) || splitsPair(segment.text, end)))
      throw new Error("Invalid explanation selection");
    if (index >= first && index <= last && start < end) selected.push({ segmentIndex: page.offset + index, startChar: start, endChar: end,
      text: segment.text.slice(start, end), offsetMs: segment.offsetMs, durationMs: segment.durationMs });
    let from = index < first ? Math.max(0, segment.text.length - 256) : index > last ? 0 : Math.max(0, start - 256);
    let to = index < first ? segment.text.length : index > last ? Math.min(segment.text.length, 256) : Math.min(segment.text.length, end + 256);
    if (splitsPair(segment.text, from)) from++;
    if (splitsPair(segment.text, to)) to--;
    excerpts.push({ segmentIndex: page.offset + index, startChar: from, text: segment.text.slice(from, to) });
  }
  const selectedText = selected.map(part => part.text).join("\n");
  if (!selectedText.trim() || selectedText.length > 2000) throw new Error("Invalid explanation selection");
  const source = { ownerId: page.ownerId, bindingId: page.context.bindingId, nodeId: page.context.nodeId, videoId: page.context.videoId,
    sourceRunId: page.sourceRunId, sourceBlueprintVersion: page.sourceBlueprintVersion, sourceCreatedAt: page.sourceCreatedAt,
    contentExpiresAt: page.contentExpiresAt, language: page.language, offset: page.offset };
  const evidenceSha256 = hash({ source, selected, excerpts });
  const requestSha256 = hash({ evidenceSha256, question, targetLanguage: "zh-Hans" });
  const prompt = JSON.stringify({ sourceLanguage: page.language, targetLanguage: "zh-Hans", question,
    selected: selected.map(({ segmentIndex, startChar, endChar, text }) => ({ segmentIndex, startChar, endChar, text })), excerpts });
  if (Buffer.byteLength(prompt, "utf8") > 32 * 1024) throw new Error("Invalid explanation selection");
  return { source: { ...source, evidenceSha256 }, requestSha256, selected, excerpts, prompt };
}

export function explanationAnswerMatches(answer: z.infer<typeof explanationAnswerSchema>, evidence: ReturnType<typeof explanationEvidence>) {
  if (answer.kind === "insufficient_context") return true;
  let selectedEvidence = false;
  const seen = new Set<string>();
  for (const item of answer.evidence) {
    const excerpt = evidence.excerpts.find(part => part.segmentIndex === item.segmentIndex), key = JSON.stringify(item);
    if (!excerpt || !excerpt.text.includes(item.quote) || seen.has(key)) return false;
    seen.add(key);
    const target = evidence.selected.find(part => part.segmentIndex === item.segmentIndex);
    for (let at = excerpt.text.indexOf(item.quote); at >= 0; at = excerpt.text.indexOf(item.quote, at + 1)) {
      if (target) {
        const overlapStart = Math.max(target.startChar, excerpt.startChar + at);
        const overlapEnd = Math.min(target.endChar, excerpt.startChar + at + item.quote.length);
        if (overlapStart < overlapEnd && target.text.slice(overlapStart - target.startChar, overlapEnd - target.startChar).trim()) selectedEvidence = true;
      }
    }
  }
  return selectedEvidence;
}
