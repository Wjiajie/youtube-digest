type RecordValue = Record<string, unknown>;
type Client = {
  auth: {
    getClaims(jwt: string): Promise<{ data: { claims: RecordValue } | null; error: unknown }>;
    getUser(jwt: string): Promise<{ data: { user: { id: string; is_anonymous?: boolean; role?: string } | null }; error: unknown }>;
  };
  rpc(name: "claim_path_planning" | "finish_path_planning", args: RecordValue): PromiseLike<{ data: unknown; error: unknown }>;
};
type Environment = { url: string; anonKey: string; serviceRoleKey: string; workerSecret: string };
type ClientFactory = (url: string, key: string, options: {
  auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false };
}) => Client;
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
const limit = 8 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: RecordValue, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const uuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const string = (value: unknown, max: number, min = 0): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const array = (value: unknown, max: number, valid: (item: unknown) => boolean, min = 0): boolean => Array.isArray(value) && value.length >= min && value.length <= max && value.every(valid);

function skill(value: unknown): value is RecordValue {
  return object(value) && exact(value, ["name", "version", "sha256", "instructions"])
    && value.name === "blueprint-plan-path" && string(value.version, 64, 1) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version)
    && string(value.sha256, 64, 64) && /^[a-f0-9]{64}$/.test(value.sha256) && string(value.instructions, 32000, 1);
}
function usage(value: unknown): boolean {
  return object(value) && exact(value, ["inputTokens", "outputTokens", "totalTokens"])
    && Object.values(value).every(token => token === null || integer(token, 0));
}
// The Node planner owns canonical domain validation; SQL owns captured source and
// lease invariants. This boundary validates the bounded result envelope, not a second domain model.
function result(value: unknown): value is RecordValue {
  if (!object(value) || typeof value.status !== "string" || typeof value.providerMayHaveRun !== "boolean" || !(value.usage === null || usage(value.usage))) return false;
  if (value.status !== "ready") return exact(value, ["status", "providerMayHaveRun", "usage"])
    && ["invalid_input", "needs_confirmation", "unavailable", "invalid_output", "cancelled", "timed_out"].includes(value.status);
  if (!exact(value, ["status", "providerMayHaveRun", "usage", "draft", "schedule", "assumptions", "skill", "source"])
    || value.providerMayHaveRun !== true || !usage(value.usage) || !object(value.draft) || value.draft.schemaVersion !== 2
    || !array(value.draft.goals, 12, object, 1) || !skill(value.skill)
    || !array(value.schedule, 128, item => object(item) && exact(item, ["nodeId", "week"]) && uuid(item.nodeId) && integer(item.week, 1, 26), 1)
    || !array(value.assumptions, 8, item => string(item, 500)) || !object(value.source)) return false;
  const source = value.source;
  return exact(source, ["runId", "briefId", "briefRevision", "blueprintId", "blueprintVersion", "startDate"])
    && uuid(source.runId) && uuid(source.briefId) && uuid(source.blueprintId) && integer(source.briefRevision, 1)
    && integer(source.blueprintVersion, 0) && typeof source.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.startDate)
    && Number.isFinite(Date.parse(`${source.startDate}T00:00:00Z`)) && new Date(`${source.startDate}T00:00:00Z`).toISOString().slice(0, 10) === source.startDate;
}
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) throw new RangeError();
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  // Drain a bounded body before replying: early Content-Length rejection can
  // reset the Edge proxy connection instead of delivering the intended 413.
  if (declared !== null && Number(declared) > limit) throw new RangeError();
  const bytes = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function sameSecret(left: string, right: string) {
  const hashes = await Promise.all([left, right].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]); let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
const safeErrors: Record<string, string[]> = {
  "42501": ["PATH_PLANNING_FORBIDDEN"], P0002: ["PATH_PLANNING_NOT_FOUND"],
  "22023": ["PATH_PLANNING_INVALID", "PATH_PLANNING_INVALID_SKILL", "PATH_PLANNING_INVALID_RESULT", "PATH_PLANNING_COMPLETION_REUSED", "PATH_PLANNING_INVALID_STATE"],
  "40001": ["PATH_PLANNING_VERSION_CONFLICT"], P0001: ["PATH_PLANNING_BUSY", "PATH_PLANNING_QUOTA_EXHAUSTED"],
};
const errorStatus: Record<string, number> = { "42501": 403, P0002: 404, "22023": 422, "40001": 409, P0001: 409 };
const reply = (data: unknown, error: { code: string; message: string } | null, status = 200) => Response.json({ data, error }, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const failure = (status: number, code = "22023", message = "PATH_PLANNING_INVALID") => reply(null, { code, message }, status);
const unavailable = () => failure(503, "XX000", "PATH_PLANNING_WORKER_UNAVAILABLE");

/** Only the Supabase Edge entry constructs the service-role client. No browser CORS or generic RPC proxy. */
export function createPlanningWorker(env: Environment, createClient: ClientFactory) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return failure(405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return failure(415);
    if (!env.url || !env.anonKey || !env.serviceRoleKey || env.workerSecret.length < 32 || env.workerSecret.trim() !== env.workerSecret
      || env.workerSecret === env.anonKey || env.workerSecret === env.serviceRoleKey || /^sb_(secret|publishable)_/.test(env.workerSecret)
      || /^[^.]+\.[^.]+\.[^.]+$/.test(env.workerSecret)) return unavailable();
    try {
      if (!(await sameSecret(request.headers.get("x-blueprint-worker-secret") ?? "", env.workerSecret))) return failure(403, "42501", "PATH_PLANNING_FORBIDDEN");
      const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get("authorization") ?? "");
      if (!bearer) return failure(401, "42501", "PATH_PLANNING_FORBIDDEN");
      let payload: unknown;
      try { payload = await readBody(request); } catch (error) { return failure(error instanceof RangeError ? 413 : 422); }
      if (!object(payload) || !uuid(payload.runId) || !uuid(payload.leaseId)) return failure(422);
      if (payload.operation === "claim") {
        if (!exact(payload, ["operation", "runId", "leaseId", "skill"]) || !skill(payload.skill)) return failure(422);
      } else if (payload.operation === "finish") {
        if (!exact(payload, ["operation", "runId", "leaseId", "result"]) || !result(payload.result)) return failure(422);
      } else return failure(422);
      const userClient = createClient(env.url, env.anonKey, authOptions);
      const [verified, current] = await Promise.all([userClient.auth.getClaims(bearer[1]), userClient.auth.getUser(bearer[1])]);
      const authErrors = [verified.error, current.error].filter(error => error !== null && error !== undefined);
      if (authErrors.length) {
        // An unavailable verifier cannot establish that the user's identity is invalid.
        if (authErrors.some(error => !object(error) || typeof error.status !== "number" || ![400, 401, 403, 422].includes(error.status))) return unavailable();
        return failure(401, "42501", "PATH_PLANNING_FORBIDDEN");
      }
      const claims = verified.data?.claims, user = current.data.user;
      if (!claims || !user || !uuid(claims.sub) || claims.sub !== user.id
        || claims.role !== "authenticated" || user.role !== "authenticated" || claims.is_anonymous !== false || user.is_anonymous !== false
        || Object.hasOwn(claims, "client_id") || !uuid(claims.session_id) || !integer(claims.exp, 1) || claims.exp <= Date.now() / 1000) {
        return failure(401, "42501", "PATH_PLANNING_FORBIDDEN");
      }
      // getClaims verifies the signature; getUser rechecks Auth. This does not introduce
      // an auth.sessions lookup or promise stronger immediate revocation than existing Auth.
      const admin = createClient(env.url, env.serviceRoleKey, authOptions);
      const outcome = payload.operation === "claim"
        ? await admin.rpc("claim_path_planning", { p_owner_id: user.id, p_run_id: payload.runId, p_lease_id: payload.leaseId, p_skill: payload.skill })
        : await admin.rpc("finish_path_planning", { p_owner_id: user.id, p_run_id: payload.runId, p_lease_id: payload.leaseId, p_result: payload.result });
      if (outcome.error) {
        const error = outcome.error;
        if (object(error) && typeof error.code === "string" && typeof error.message === "string" && safeErrors[error.code]?.includes(error.message)) {
          return reply(null, { code: error.code, message: error.message }, errorStatus[error.code]);
        }
        return unavailable();
      }
      return reply(outcome.data ?? null, null);
    } catch { return unavailable(); }
  };
}
