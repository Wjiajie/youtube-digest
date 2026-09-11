import { createHash } from "node:crypto";
import { z } from "zod";
import { selectExplanationEvidence, explanationSelectionSchema, type parseLearningTranscript } from "@blueprint/domain";
export { explanationSelectionSchema, explanationAnswerSchema, explanationAnswerMatches } from "@blueprint/domain";

type Page = Extract<ReturnType<typeof parseLearningTranscript>, { status: "ready" }>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Shared by inference and recovery: rebuild evidence only from an authorized,
 * parsed source page. Browser text, model quotations and hashes are never inputs. */
export function explanationEvidence(page: Page, selection: z.infer<typeof explanationSelectionSchema>, question: string) {
  const { selected, excerpts } = selectExplanationEvidence(page, selection);
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
