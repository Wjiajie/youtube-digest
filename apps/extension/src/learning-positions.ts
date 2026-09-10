import { learningPositionBindingFilterSchema, learningPositionSchema, parseLearningPositionWorkspace, recordLearningPositionSchema, type ApplicationResult, type LearningPosition, type LearningPositionWorkspace } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";

export function createLearningPositionsTransport(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize, request } = createAuthenticatedTransport(auth, apiBase);
  return {
    async load(ownerId: unknown, resourceBindingId?: unknown): Promise<ApplicationResult<LearningPositionWorkspace>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const filter = learningPositionBindingFilterSchema.safeParse(resourceBindingId);
        if (!filter.success) return { ok: false, code: "invalid" };
        return request(identity.value, `learning-positions${filter.data ? `?resourceBindingId=${filter.data}` : ""}`, value => {
          const workspace = parseLearningPositionWorkspace(value);
          if (filter.data && workspace.records.some(record => record.resource.bindingId !== filter.data)) throw new Error("Position filter mismatch");
          return workspace;
        });
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async save(ownerId: unknown, input: unknown): Promise<ApplicationResult<LearningPosition>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const parsed = recordLearningPositionSchema.safeParse(input);
        if (!parsed.success) return { ok: false, code: "invalid" };
        const command = parsed.data;
        // Exact replay is resolved by the server before source/CAS checks, including archived sources.
        const result = await request(identity.value, "learning-positions", value => learningPositionSchema.parse(value), command);
        if (result.ok && (result.value.clientMutationId !== command.clientMutationId || result.value.context.nodeId !== command.nodeId
          || result.value.context.blueprintVersion !== command.expectedVersion || result.value.resource.bindingId !== command.resourceBindingId
          || result.value.expectedPositionVersion !== command.expectedPositionVersion || result.value.positionSeconds !== command.positionSeconds)) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
