import { learningNoteSchema, parseCurrentBlueprintSnapshot, recordLearningNoteSchema, type ApplicationResult, type LearningNote, type LearningNoteWorkspace } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";

const noteRecord = learningNoteSchema.extend({ context: learningNoteSchema.shape.context.strict(), resource: learningNoteSchema.shape.resource.strict() }).strict();
export function createLearningNotesTransport(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize, request } = createAuthenticatedTransport(auth, apiBase);
  return {
    async load(ownerId: unknown): Promise<ApplicationResult<LearningNoteWorkspace>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        return request(identity.value, "learning-notes", parseWorkspace);
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async save(ownerId: unknown, input: unknown): Promise<ApplicationResult<LearningNote>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const parsed = recordLearningNoteSchema.safeParse(input);
        if (!parsed.success) return { ok: false, code: "invalid" };
        const command = parsed.data;
        // Do not reread current bindings: the server recovers exact historic receipts first.
        const result = await request(identity.value, "learning-notes", value => noteRecord.parse(value), command);
        if (result.ok && (result.value.clientMutationId !== command.clientMutationId || result.value.context.nodeId !== command.nodeId
          || result.value.context.blueprintVersion !== command.expectedVersion || result.value.resource.bindingId !== command.resourceBindingId
          || result.value.text !== command.text || result.value.positionSeconds !== command.positionSeconds)) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}

function parseWorkspace(input: unknown): LearningNoteWorkspace {
  if (typeof input !== "object" || input === null || Array.isArray(input)
    || !("blueprint" in input) || !("records" in input) || Object.keys(input).length !== 2) throw new Error("Invalid note workspace");
  const blueprint = parseCurrentBlueprintSnapshot(input.blueprint);
  const records = noteRecord.array().max(50).parse(input.records);
  const ids = new Set<string>(), mutations = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id) || mutations.has(record.clientMutationId) || record.context.blueprintId !== blueprint.id
      || record.context.blueprintVersion > blueprint.version) throw new Error("Invalid note source");
    ids.add(record.id); mutations.add(record.clientMutationId);
  }
  // History is deliberately not joined to current nodes/bindings: replay survives removal.
  return { blueprint, records };
}
