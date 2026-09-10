import { blueprintSnapshotSchema, progressEvidenceSchema, recordProgressEvidenceSchema,
  type ApplicationResult, type EvidenceWorkspace, type ProgressEvidence } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";

type Auth = ReturnType<typeof createExtensionAuthPort>;

// Private drafts and exact uncertain retries stay in the shared journal,
// never the session outbox; HTTP classification is shared with assessment.
export function createEvidenceTransport(auth: Auth, apiBase: string) {
  const { authorize, request } = createAuthenticatedTransport(auth, apiBase);
  return {
    async load(ownerId: unknown): Promise<ApplicationResult<EvidenceWorkspace>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const [blueprint, records] = await Promise.all([
          request(identity.value, "blueprint", (value) => blueprintSnapshotSchema.parse(value)),
          request(identity.value, "progress-evidence", (value) => progressEvidenceSchema.array().max(50).parse(value)),
        ]);
        if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" };
        if (!blueprint.ok) return blueprint;
        if (!records.ok && (records.code === "forbidden" || records.code === "unauthenticated")) return records;
        if (records.ok && records.value.some((entry) => entry.context.blueprintId !== blueprint.value.id)) return { ok: false, code: "unavailable" };
        return { ok: true, value: { blueprint: blueprint.value, records } };
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async save(ownerId: unknown, input: unknown): Promise<ApplicationResult<ProgressEvidence>> {
      try {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const parsed = recordProgressEvidenceSchema.safeParse(input);
        if (!parsed.success) return { ok: false, code: "invalid" };
        const result = await request(identity.value, "progress-evidence", (value) => progressEvidenceSchema.parse(value), parsed.data);
        if (result.ok && (result.value.clientMutationId !== parsed.data.clientMutationId || result.value.context.nodeId !== parsed.data.nodeId)) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
