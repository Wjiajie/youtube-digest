import {
  confirmNodeStatusSchema, nodeStatusRecordSchema, parseCurrentBlueprintSnapshot, progressEvidenceSchema,
  type ApplicationResult, type NodeStatusRecord, type NodeStatusWorkspace, type ProgressEvidence,
} from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";

const statusRecord = nodeStatusRecordSchema.extend({ context: nodeStatusRecordSchema.shape.context.strict() }).strict()
  .refine((value) => value.evidenceId === null || value.status === "completed");
const evidenceRecord = progressEvidenceSchema.extend({ context: progressEvidenceSchema.shape.context.strict() }).strict();

export function createNodeStatusTransport(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize, request } = createAuthenticatedTransport(auth, apiBase);
  return {
    async load(ownerId: unknown): Promise<ApplicationResult<NodeStatusWorkspace>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const result = await request(identity.value, "node-status", parseWorkspace);
        if (result.ok && !result.value.evidence.ok
          && (result.value.evidence.code === "forbidden" || result.value.evidence.code === "unauthenticated")) return result.value.evidence;
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async confirm(ownerId: unknown, input: unknown): Promise<ApplicationResult<NodeStatusRecord>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const parsed = confirmNodeStatusSchema.safeParse(input);
        if (!parsed.success) return { ok: false, code: "invalid" };
        const command = parsed.data;
        const result = await request(identity.value, "node-status", (value) => statusRecord.parse(value), command);
        if (result.ok && (result.value.clientMutationId !== command.clientMutationId
          || result.value.context.nodeId !== command.nodeId || result.value.context.blueprintVersion !== command.expectedVersion
          || result.value.revision !== command.expectedStatusRevision + 1 || result.value.status !== command.status
          || result.value.evidenceId !== (command.evidenceId ?? null))) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}

function parseWorkspace(input: unknown): NodeStatusWorkspace {
  const object = strictObject(input, ["blueprint", "current", "history", "evidence"]);
  const blueprint = parseCurrentBlueprintSnapshot(object.blueprint);
  const nodeIds = new Set(blueprint.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.map((node) => node.id))));
  // Current status is one per active node, not the bounded recent-history page.
  const current = statusRecord.array().max(nodeIds.size).parse(object.current);
  const history = statusRecord.array().max(50).parse(object.history);
  const evidence = parseEvidence(object.evidence);
  const currentNodes = new Set<string>();
  const records = new Map<string, NodeStatusRecord>();
  const mutations = new Map<string, string>();
  const revisions = new Map<string, string>();
  for (const record of current) {
    if (!nodeIds.has(record.context.nodeId) || currentNodes.has(record.context.nodeId)) throw new Error("Invalid current status identity");
    currentNodes.add(record.context.nodeId);
  }
  for (const group of [current, history]) {
    const ids = new Set<string>();
    for (const record of group) {
      if (ids.has(record.id) || record.context.blueprintId !== blueprint.id || record.context.blueprintVersion > blueprint.version) throw new Error("Invalid status source");
      ids.add(record.id);
      const prior = records.get(record.id);
      const revisionKey = `${record.context.nodeId}:${record.revision}`;
      if ((prior && JSON.stringify(prior) !== JSON.stringify(record))
        || (mutations.has(record.clientMutationId) && mutations.get(record.clientMutationId) !== record.id)
        || (revisions.has(revisionKey) && revisions.get(revisionKey) !== record.id)) throw new Error("Inconsistent status receipt");
      records.set(record.id, record);
      mutations.set(record.clientMutationId, record.id);
      revisions.set(revisionKey, record.id);
    }
  }
  const latest = new Map(current.map((record) => [record.context.nodeId, record]));
  for (const record of history) {
    const actual = latest.get(record.context.nodeId);
    if (nodeIds.has(record.context.nodeId) && (!actual || record.revision > actual.revision)) throw new Error("Inconsistent current status");
  }
  if (evidence.ok) {
    const ids = new Set<string>();
    const mutations = new Set<string>();
    for (const record of evidence.value) {
      if (ids.has(record.id) || mutations.has(record.clientMutationId) || record.context.blueprintId !== blueprint.id
        || record.context.blueprintVersion > blueprint.version) throw new Error("Invalid evidence source");
      ids.add(record.id);
      mutations.add(record.clientMutationId);
    }
  }
  return { blueprint, current, history, evidence };
}

function parseEvidence(input: unknown): ApplicationResult<ProgressEvidence[]> {
  if (typeof input === "object" && input !== null && "ok" in input && input.ok === true) {
    const object = strictObject(input, ["ok", "value"]);
    return { ok: true, value: evidenceRecord.array().max(50).parse(object.value) };
  }
  const object = strictObject(input, ["ok", "code"], ["message"]);
  const codes = ["unauthenticated", "forbidden", "not_found", "invalid", "version_conflict", "unavailable"] as const;
  const code = codes.find((candidate) => candidate === object.code);
  if (object.ok !== false || !code || (object.message !== undefined && typeof object.message !== "string")) throw new Error("Invalid evidence result");
  return { ok: false, code, ...(typeof object.message === "string" ? { message: object.message } : {}) };
}

function strictObject(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || required.some((key) => !Object.hasOwn(input, key))
    || Object.keys(input).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("Invalid workspace response");
  return input as Record<string, unknown>;
}
