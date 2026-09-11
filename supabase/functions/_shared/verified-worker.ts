export type RecordValue = Record<string, unknown>;
type Client<Name extends string> = {
  auth: {
    getClaims(jwt: string): Promise<{ data: { claims: RecordValue } | null; error: unknown }>;
    getUser(jwt: string): Promise<{ data: { user: { id: string; is_anonymous?: boolean; role?: string } | null }; error: unknown }>;
  };
  rpc(name: Name, args: RecordValue): PromiseLike<{ data: unknown; error: unknown }>;
};
export type Environment = { url: string; anonKey: string; serviceRoleKey: string; workerSecret: string };
export type ClientFactory<Name extends string> = (url: string, key: string, options: {
  auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false };
}) => Client<Name>;
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const object = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
export const exact = (value: RecordValue, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
export const uuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
export const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export const string = (value: unknown, max: number, min = 0): value is string => typeof value === "string" && value.length >= min && value.length <= max;
export const array = (value: unknown, max: number, valid: (item: unknown) => boolean, min = 0): boolean => Array.isArray(value) && value.length >= min && value.length <= max && value.every(valid);

export function skill(value: unknown, name: string): value is RecordValue {
  return object(value) && exact(value, ["name", "version", "sha256", "instructions"])
    && value.name === name && string(value.version, 64, 1) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version)
    && string(value.sha256, 64, 64) && /^[a-f0-9]{64}$/.test(value.sha256) && string(value.instructions, 32000, 1);
}
export function usage(value: unknown): boolean {
  return object(value) && exact(value, ["inputTokens", "outputTokens", "totalTokens"])
    && Object.values(value).every(token => token === null || integer(token, 0));
}
async function readBody(request: Request, limit: number): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) throw new RangeError();
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DOMException("Body deadline exceeded", "TimeoutError")), 5_000);
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]); if (chunk.done) break;
      size += chunk.value.byteLength;
      // The Edge proxy can stall responses when an upload is cancelled mid-body.
      // Drain without retaining excess bytes, but never beyond the read deadline.
      if (size > limit) continue;
      chunks.push(chunk.value);
    }
  } catch (error) {
    // Stream cancellation itself may never settle; it must not extend the deadline.
    void reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timer); reader.releaseLock(); }
  if (size > limit || (declared !== null && Number(declared) > limit)) throw new RangeError();
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
const errorStatus: Record<string, number> = { "42501": 403, P0002: 404, "22023": 422, "40001": 409, P0001: 409 };
const reply = (data: unknown, error: { code: string; message: string } | null, status = 200) => Response.json({ data, error }, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

/** Only the Supabase Edge entry constructs the service-role client. No browser CORS or generic RPC proxy. */
export function createVerifiedWorker<Name extends string>(env: Environment, createClient: ClientFactory<Name>, policy: {
  bodyLimit: number;
  errorPrefix: string;
  safeErrors: Record<string, string[]>;
  /** Absent by default: only a worker with an explicit trusted opt-in can accept OAuth. */
  allowedOAuthClientId?: string;
  decodeOperation(payload: unknown): { name: Name; args: RecordValue } | null;
}) {
  const failure = (status: number, code = "22023", message = `${policy.errorPrefix}_INVALID`) => reply(null, { code, message }, status);
  const unavailable = () => failure(503, "XX000", `${policy.errorPrefix}_WORKER_UNAVAILABLE`);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return failure(405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return failure(415);
    if (!env.url || !env.anonKey || !env.serviceRoleKey || env.workerSecret.length < 32 || env.workerSecret.trim() !== env.workerSecret
      || env.workerSecret === env.anonKey || env.workerSecret === env.serviceRoleKey || /^sb_(secret|publishable)_/.test(env.workerSecret)
      || /^[^.]+\.[^.]+\.[^.]+$/.test(env.workerSecret)) return unavailable();
    try {
      if (!(await sameSecret(request.headers.get("x-blueprint-worker-secret") ?? "", env.workerSecret))) return failure(403, "42501", `${policy.errorPrefix}_FORBIDDEN`);
      const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get("authorization") ?? "");
      if (!bearer) return failure(401, "42501", `${policy.errorPrefix}_FORBIDDEN`);
      let payload: unknown;
      try { payload = await readBody(request, policy.bodyLimit); } catch (error) {
        return failure(error instanceof RangeError ? 413 : error instanceof DOMException && error.name === "TimeoutError" ? 408 : 422);
      }
      const operation = policy.decodeOperation(payload);
      if (!operation) return failure(422);
      const userClient = createClient(env.url, env.anonKey, authOptions);
      const [verified, current] = await Promise.all([userClient.auth.getClaims(bearer[1]), userClient.auth.getUser(bearer[1])]);
      const authErrors = [verified.error, current.error].filter(error => error !== null && error !== undefined);
      if (authErrors.length) {
        // An unavailable verifier cannot establish that the user's identity is invalid.
        if (authErrors.some(error => !object(error) || typeof error.status !== "number" || ![400, 401, 403, 422].includes(error.status))) return unavailable();
        return failure(401, "42501", `${policy.errorPrefix}_FORBIDDEN`);
      }
      const claims = verified.data?.claims, user = current.data.user;
      const oauthAllowed = !claims || !Object.hasOwn(claims, "client_id") ||
        (typeof policy.allowedOAuthClientId === "string" && policy.allowedOAuthClientId.length > 0
          && policy.allowedOAuthClientId.trim() === policy.allowedOAuthClientId && claims.client_id === policy.allowedOAuthClientId);
      if (!claims || !user || !uuid(claims.sub) || claims.sub !== user.id
        || claims.role !== "authenticated" || user.role !== "authenticated" || claims.is_anonymous !== false || user.is_anonymous !== false
        || !oauthAllowed || !uuid(claims.session_id) || !integer(claims.exp, 1) || claims.exp <= Date.now() / 1000) {
        return failure(401, "42501", `${policy.errorPrefix}_FORBIDDEN`);
      }
      // getClaims verifies the signature; getUser rechecks Auth. This does not introduce
      // an auth.sessions lookup or promise stronger immediate revocation than existing Auth.
      const admin = createClient(env.url, env.serviceRoleKey, authOptions);
      const outcome = await admin.rpc(operation.name, { ...operation.args, p_owner_id: user.id });
      if (outcome.error) {
        const error = outcome.error;
        if (object(error) && typeof error.code === "string" && typeof error.message === "string" && policy.safeErrors[error.code]?.includes(error.message)) {
          return reply(null, { code: error.code, message: error.message }, errorStatus[error.code]);
        }
        return unavailable();
      }
      return reply(outcome.data ?? null, null);
    } catch { return unavailable(); }
  };
}
