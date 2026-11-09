import { describe, expect, it } from "vitest";
import {
  avatarCueSchema,
  isExplicitConfirmation,
  toolInputs,
} from "./contracts";
import { z } from "zod";
describe("companion command boundaries", () => {
  it("publishes object-root provider tool schemas and still rejects mismatched avatar channels", () => {
    for (const schema of Object.values(toolInputs))
      expect(z.toJSONSchema(schema, { target: "draft-7" }).type).toBe("object");
    expect(
      toolInputs.avatar_cue.safeParse({ kind: "motion", id: "happy" }).success,
    ).toBe(false);
    expect(
      toolInputs.avatar_cue.safeParse({ kind: "expression", id: "wave" })
        .success,
    ).toBe(false);
    expect(
      toolInputs.avatar_cue.safeParse({ kind: "motion", id: "wave" }).success,
    ).toBe(true);
  });
  it("does not interpret quotes or ambiguous acknowledgements as confirmation", () => {
    for (const input of [
      "好",
      "不要确认保存",
      "他说确认保存",
      "确认保存吗？",
      "请不要采纳",
    ])
      expect(isExplicitConfirmation(input)).toBe(false);
    expect(isExplicitConfirmation("确认保存！")).toBe(true);
  });
  it("rejects arbitrary motions and unbounded expression weights", () => {
    expect(
      avatarCueSchema.safeParse({ kind: "motion", id: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      avatarCueSchema.safeParse({
        kind: "expression",
        id: "happy",
        intensity: 8,
      }).success,
    ).toBe(false);
  });
});
