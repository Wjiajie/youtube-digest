import { z } from "zod";

const kindSchema = z.enum(["expression", "motion", "clothing", "hair", "raw"]);
const controlSchema = z.object({
  kind: kindSchema,
  id: z.string().min(1).max(200).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)),
  label: z.string().min(1).max(120),
}).strict();
const snapshotSchema = z.object({
  revision: z.uuid(),
  modelId: z.string().min(1).max(120).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)),
  controls: z.array(controlSchema).max(256),
}).strict();
export type AvatarCapabilitiesSnapshot = z.infer<typeof snapshotSchema>;
export type AvatarControl = {
  revision: string;
  kind: z.infer<typeof kindSchema>;
  id: string;
  value?: number | boolean;
  duration?: number;
};
/** The model-specific adapter owns discovery, execution and lifecycle. */
export interface AvatarAgentAdapter {
  getAgentCapabilities(): AvatarCapabilitiesSnapshot | null;
  applyAgentControl(control: AvatarControl, ownerTurn: number): boolean;
}
/** Model metadata comes from the browser; it is bounded data, never code. */
export function normalizeAvatarCapabilities(input: unknown): AvatarCapabilitiesSnapshot | null {
  if (!input || typeof input !== "object" || !Array.isArray((input as any).controls)) return null;
  const cleaned = { ...(input as any), controls: (input as any).controls.map((c: any) =>
    c && typeof c === "object" && typeof c.label === "string"
      ? { ...c, label: c.label.replace(/[\u0000-\u001f\u007f]/g, " ").trim() }
      : c) };
  const parsed = snapshotSchema.safeParse(cleaned);
  if (!parsed.success) return null;
  const keys = new Set<string>();
  for (const c of parsed.data.controls) {
    const key = `${c.kind}\0${c.id}`;
    if (keys.has(key)) return null;
    keys.add(key);
  }
  return parsed.data;
}
export function avatarControlSchema(snapshot: AvatarCapabilitiesSnapshot) {
  const ids = [...new Set(snapshot.controls.map((c) => c.id))];
  const kinds = [...new Set(snapshot.controls.map((c) => c.kind))];
  return z.object({
    revision: z.literal(snapshot.revision),
    kind: z.enum(kinds.length ? kinds : ["expression"]),
    id: z.enum(ids.length ? ids : ["__unavailable__"]),
    value: z.union([z.number().finite().min(0).max(1), z.boolean()]).optional(),
    duration: z.number().finite().min(0.2).max(15).optional(),
  }).strict().superRefine((v, ctx) => {
    if (!snapshot.controls.some((c) => c.kind === v.kind && c.id === v.id))
      ctx.addIssue({ code: "custom", message: "Control is unavailable on the current model" });
    if (v.kind === "motion" ? v.value !== undefined :
      v.kind === "clothing" ? typeof v.value !== "boolean" : typeof v.value !== "number")
      ctx.addIssue({ code: "custom", message: "Invalid value for control kind" });
    if (v.duration !== undefined && v.kind !== "expression" && v.kind !== "raw")
      ctx.addIssue({ code: "custom", message: "Duration is only available for face controls" });
  });
}
export function avatarProviderTools(snapshot: AvatarCapabilitiesSnapshot | null) {
  if (!snapshot?.controls.length) return [];
  return [{
    type: "function" as const, name: "avatar_control",
    description: "控制当前角色的可用表情、动作或外观。仅从当前能力目录选择 kind 与 id；动作无需 value，服装使用布尔值，其他参数为0至1。仅在用户明确要求时改变服装或头发；不要编造角色能力。目录：" + JSON.stringify(snapshot.controls),
    parameters: z.toJSONSchema(avatarControlSchema(snapshot), { target: "draft-7" }),
  }];
}
