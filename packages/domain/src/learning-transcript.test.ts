import { describe, expect, it } from "vitest";
import { learningTranscriptRequestSchema, parseLearningTranscript } from "./learning-transcript";

const owner = "10000000-0000-4000-8000-000000000001";
const binding = "10000000-0000-4000-8000-000000000002";
const source = "10000000-0000-4000-8000-000000000003";
const command = { bindingId: binding, videoId: "abcdefghijk" };
const ready = { ownerId: owner, context: { bindingId: binding, nodeId: owner, nodeTitle: "理解曝光", goalId: owner, goalTitle: "摄影", videoId: "abcdefghijk" },
  observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: source, sourceBlueprintVersion: 2,
  sourceCreatedAt: "2026-09-10T00:00:00Z", contentExpiresAt: "2026-09-12T00:00:00Z", title: "Exposure", language: "en", offset: 0, totalSegments: 1,
  segments: [{ text: "  Exposure <not markup>  ", offsetMs: 1500, durationMs: 2100 }] };

describe("bound learning transcript reads", () => {
  it("preserves original text and historical source while pinning the requested account and video", () => {
    expect(learningTranscriptRequestSchema.parse(command)).toEqual({ ...command, sourceRunId: null, offset: 0 });
    expect(parseLearningTranscript(ready, owner, command)).toEqual(ready);
  });
  it("rejects expired, inconsistent or body-bearing unavailable responses without normalizing the material", () => {
    for (const change of [
      { contentExpiresAt: ready.observedAt }, { sourceCreatedAt: ready.contentExpiresAt },
      { segments: [] }, { totalSegments: 21 }, { segments: [{ text: "   ", offsetMs: 0, durationMs: 1 }] },
      { segments: [{ text: "Overflow", offsetMs: Number.MAX_SAFE_INTEGER, durationMs: 1 }] },
    ]) expect(() => parseLearningTranscript({ ...ready, ...change }, owner, command)).toThrow();
    const unavailable = { ownerId: owner, context: ready.context, observedAt: ready.observedAt, status: "unavailable", reason: "expired" };
    expect(parseLearningTranscript(unavailable, owner, command)).toEqual(unavailable);
    expect(() => parseLearningTranscript({ ...unavailable, segments: ready.segments }, owner, command)).toThrow();
  });
  it("rejects foreign accounts, wrong videos, implicit source switching, and unsafe paging commands", () => {
    for (const change of [{ ownerId: binding }, { context: { ...ready.context, bindingId: owner } },
      { context: { ...ready.context, videoId: "ZYXWVUTSRQP" } }, { private: "BODY" }])
      expect(() => parseLearningTranscript({ ...ready, ...change }, owner, command)).toThrow();
    expect(() => parseLearningTranscript(ready, owner, { ...command, sourceRunId: binding })).toThrow();
    for (const change of [{ offset: 20 }, { offset: 1 }, { offset: -1 }, { offset: 20000 }, { sourceRunId: "bad" }, { extra: "x" }])
      expect(learningTranscriptRequestSchema.safeParse({ ...command, ...change }).success).toBe(false);
    expect(parseLearningTranscript({ ...ready, offset: 20, segments: [] }, owner, { ...command, sourceRunId: source, offset: 20 }).status).toBe("ready");
  });
});
