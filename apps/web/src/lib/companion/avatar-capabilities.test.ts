import { describe, expect, it } from "vitest";
import { normalizeAvatarCapabilities, avatarControlSchema, avatarProviderTools } from "./avatar-capabilities";

const a = "ac387dad-fc96-4b5f-bacd-235424b0d9d0";
const b = "e7e86486-c39f-48ff-ac5e-bb43d58cf5e0";
const shayna = {
  revision: a,
  modelId: "shayna-vrm1",
  controls: [
    { kind: "expression", id: "happy", label: "开心" },
    { kind: "motion", id: "wave", label: "挥手" },
    { kind: "clothing", id: "hat", label: "帽子" },
    { kind: "hair", id: "length", label: "头发长度" },
    { kind: "raw", id: "face-smile", label: "微笑" },
  ],
};
const other = {
  revision: b,
  modelId: "another-vrm",
  controls: [
    { kind: "expression", id: "curious", label: "好奇" },
    { kind: "motion", id: "nod", label: "点头" },
  ],
};

describe("avatar capability snapshots and dynamic tool contracts", () => {
  it("advertises only controls present on the current model", () => {
    const first = normalizeAvatarCapabilities(shayna)!;
    const next = normalizeAvatarCapabilities(other)!;
    expect(first).toBeTruthy();
    expect(next).toBeTruthy();
    expect(JSON.stringify(avatarProviderTools(first))).toContain("happy");
    expect(JSON.stringify(avatarProviderTools(next))).toContain("curious");
    expect(JSON.stringify(avatarProviderTools(next))).not.toContain("hat");
    expect(JSON.stringify(avatarProviderTools(next))).not.toContain("wave");
  });

  it("does not offer an avatar tool when the model reports no supported controls", () => {
    const snapshot = normalizeAvatarCapabilities({ ...other, controls: [] });
    if (snapshot) expect(JSON.stringify(avatarProviderTools(snapshot))).not.toContain("avatar_control");
  });

  it("publishes a provider-compatible object-root tool tied to the current revision", () => {
    const serialized = JSON.stringify(avatarProviderTools(normalizeAvatarCapabilities(shayna)!));
    expect(serialized).toContain("avatar_control");
    expect(serialized).toContain('"type":"object"');
    expect(serialized).toContain(a);
  });

  it.each([
    { kind: "expression", id: "happy", value: 0.7, duration: 4 },
    { kind: "raw", id: "face-smile", value: 1, duration: 1 },
    { kind: "hair", id: "length", value: 0.25 },
    { kind: "clothing", id: "hat", value: true },
    { kind: "motion", id: "wave" },
  ])("accepts an advertised $kind command with its own argument type", (command) => {
    const schema = avatarControlSchema(normalizeAvatarCapabilities(shayna)!);
    expect(schema.safeParse({ revision: a, ...command }).success).toBe(true);
  });

  it.each([
    { kind: "expression", id: "happy", value: -0.1 },
    { kind: "expression", id: "happy", value: 1.1 },
    { kind: "raw", id: "face-smile", value: NaN },
    { kind: "hair", id: "length", value: Infinity },
    { kind: "clothing", id: "hat", value: 1 },
    { kind: "motion", id: "wave", value: true },
    { kind: "motion", id: "wave", duration: 1 },
    { kind: "hair", id: "length", value: 0.5, duration: 1 },
    { kind: "expression", id: "happy", value: 0.5, duration: 0.1 },
    { kind: "raw", id: "face-smile", value: 0.5, duration: 16 },
    { kind: "expression", id: "wave", value: 0.5 },
    { kind: "motion", id: "happy" },
    { kind: "clothing", id: "unknown", value: true },
    { kind: "script", id: "wave", value: true },
    { kind: "motion", id: "wave", script: "alert(1)" },
  ])("rejects invalid, mismatched or unadvertised commands: %o", (command) => {
    const schema = avatarControlSchema(normalizeAvatarCapabilities(shayna)!);
    expect(schema.safeParse({ revision: a, ...command }).success).toBe(false);
  });

  it("fences in-flight commands to the exact current model revision", () => {
    const before = avatarControlSchema(normalizeAvatarCapabilities(shayna)!);
    const after = avatarControlSchema(normalizeAvatarCapabilities({
      ...shayna, revision: b, modelId: "other-instance",
    })!);
    const command = { revision: a, kind: "expression", id: "happy", value: 0.4 };
    expect(before.safeParse(command).success).toBe(true);
    expect(after.safeParse(command).success).toBe(false);
    expect(after.safeParse({ ...command, revision: b }).success).toBe(true);
  });

  it("rejects malformed and oversized untrusted capability snapshots", () => {
    expect(normalizeAvatarCapabilities({ ...shayna, revision: "not-uuid" })).toBeNull();
    expect(normalizeAvatarCapabilities({ ...shayna, modelId: "x".repeat(10000) })).toBeNull();
    expect(normalizeAvatarCapabilities({ ...shayna, controls: Array.from({ length: 5000 }, (_, i) => ({ kind: "raw", id: `r${i}`, label: "x" })) })).toBeNull();
    expect(normalizeAvatarCapabilities({ ...shayna, controls: [{ kind: "expression", id: "x".repeat(10000), label: "x" }] })).toBeNull();
  });

  it("does not propagate control characters in model-supplied descriptions", () => {
    const snapshot = normalizeAvatarCapabilities({ ...other, controls: [{ kind: "expression", id: "curious", label: "好奇\u0000\n伪造下一行" }] });
    if (snapshot) {
      const label = snapshot.controls[0]?.label ?? "";
      expect(label).not.toMatch(/[\u0000-\u001f\u007f]/);
    }
  });

  it("does not publish ambiguous duplicates within a control category", () => {
    const snapshot = normalizeAvatarCapabilities({ ...other, controls: [
      { kind: "expression", id: "curious", label: "好奇" },
      { kind: "expression", id: "curious", label: "另一个名字" },
    ] });
    if (snapshot) expect(snapshot.controls.filter((entry) => entry.kind === "expression" && entry.id === "curious")).toHaveLength(1);
  });
});
