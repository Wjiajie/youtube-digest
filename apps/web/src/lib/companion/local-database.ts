import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningWorker } from "../agent/planning-worker";
import { localCompanionMode } from "./local-config";

type Result = { data: any; error: { code: string; message: string } | null };
const ident = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("invalid_identifier");
  return `"${value}"`;
};
const serializable = (value: unknown): any => JSON.parse(JSON.stringify(value));
const failure = (error: any): Result => ({
  data: null,
  error: {
    code: error.code ?? "unavailable",
    message: error.message ?? "unavailable",
  },
});

/** PostgreSQL persistence and production migrations, without a hosted Auth or REST server. */
export async function createLocalDatabase(
  directory: string,
  migrations: string,
) {
  if (directory !== "memory://") await mkdir(directory, { recursive: true });
  const db = new PGlite(directory, { extensions: { citext } });
  await db.waitReady;
  await db.exec(`create table if not exists public.local_schema_versions(name text primary key,sha256 text not null);
    create table if not exists public.local_profile(id uuid primary key);`);
  const applied = await db.query<{ name: string; sha256: string }>(
    "select * from public.local_schema_versions",
  );
  if (!applied.rows.length)
    await db.transaction(async (tx) => {
      await tx.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;
  `);
      await tx.query(
        "insert into public.local_schema_versions values('bootstrap','v1')",
      );
    });
  for (const file of (await readdir(migrations))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(path.join(migrations, file), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    const previous = applied.rows.find((row) => row.name === file);
    if (previous) {
      if (previous.sha256 !== digest)
        throw new Error(`Applied local migration changed: ${file}`);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into public.local_schema_versions values($1,$2)", [
        file,
        digest,
      ]);
    });
  }
  let owner = (
    await db.query<{ id: string }>(
      "select id from public.local_profile limit 1",
    )
  ).rows[0]?.id;
  if (!owner) {
    owner = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "insert into auth.users(id,email) values($1,'local@blueprint.test')",
        [owner],
      );
      await tx.query("insert into public.local_profile values($1)", [owner]);
      // A bounded local test allowance. Never touches any cloud quota or credentials.
      await tx.query(
        "insert into private.path_planning_quotas(owner_id,available_attempts) values($1,5)",
        [owner],
      );
    });
  }
  async function query(
    sql: string,
    values: any[] = [],
    role = "authenticated",
    userId = owner,
  ): Promise<Result> {
    try {
      const data = await db.transaction(async (tx) => {
        await tx.query(
          "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [userId, JSON.stringify({ sub: userId, role, is_anonymous: false })],
        );
        if (!["authenticated", "service_role"].includes(role))
          throw new Error("invalid_role");
        await tx.exec(`set local role ${role}`);
        return (await tx.query(sql, values)).rows;
      });
      return { data: serializable(data), error: null };
    } catch (error) {
      return failure(error);
    }
  }
  async function rpc(
    name: string,
    args: Record<string, unknown> = {},
    role = "authenticated",
  ): Promise<Result> {
    const entries = Object.entries(args);
    const call = `public.${ident(name)}(${entries.map(([key], i) => `${ident(key)} => $${i + 1}`).join(",")})`;
    const result = await query(
      `select to_jsonb(${call}) as receipt`,
      entries.map(([, value]) =>
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value,
      ),
      role,
    );
    return result.error
      ? result
      : { data: result.data[0]?.receipt ?? null, error: null };
  }
  const actor = { userId: owner, client: "web" as const };
  const token = () =>
    createHmac(
      "sha256",
      process.env.COMPANION_GATEWAY_SECRET ?? "local-development-only",
    )
      .update(`local:${owner}`)
      .digest("hex");
  const client = {
    from: (table: string) => new LocalQuery(table, query),
    rpc,
    auth: {
      getUser: async (value?: string) => ({
        data: { user: !value || value === token() ? { id: owner } : null },
        error: value && value !== token() ? { status: 401 } : null,
      }),
      getSession: async () => ({
        data: {
          session: {
            access_token: token(),
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
  const worker: PlanningWorker = {
    claim: (input) =>
      rpc(
        "claim_path_planning",
        {
          p_owner_id: owner,
          p_run_id: input.runId,
          p_lease_id: input.leaseId,
          p_skill: input.skill,
        },
        "service_role",
      ),
    finish: (input) =>
      rpc(
        "finish_path_planning",
        {
          p_owner_id: owner,
          p_run_id: input.runId,
          p_lease_id: input.leaseId,
          p_result: input.result,
        },
        "service_role",
      ),
  };
  return { client, actor, worker, close: () => db.close(), query };
}

/** Small parameterized query adapter for the existing repositories; no SQL arrives from a client. */
class LocalQuery implements PromiseLike<Result> {
  private operation = "select";
  private columns = "*";
  private rows: Record<string, any>[] = [];
  private filters: Array<[string, string, unknown]> = [];
  private ordering: string[] = [];
  private take = 50;
  private skip = 0;
  private cardinality = "many";
  private returning = false;
  private conflict?: { onConflict?: string; ignoreDuplicates?: boolean };
  constructor(
    private table: string,
    private query: (sql: string, params: any[]) => Promise<Result>,
  ) {
    ident(table);
  }
  select(columns = "*") {
    this.columns = columns;
    this.returning = true;
    return this;
  }
  insert(value: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert";
    this.rows = Array.isArray(value) ? value : [value];
    return this;
  }
  upsert(
    value: Record<string, unknown>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.insert(value);
    this.conflict = options;
    return this;
  }
  update(value: Record<string, unknown>) {
    this.operation = "update";
    this.rows = [value];
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push([key, "=", value]);
    return this;
  }
  gt(key: string, value: unknown) {
    this.filters.push([key, ">", value]);
    return this;
  }
  lt(key: string, value: unknown) {
    this.filters.push([key, "<", value]);
    return this;
  }
  contains(key: string, value: unknown) {
    this.filters.push([key, "@>", JSON.stringify(value)]);
    return this;
  }
  order(key: string, options?: { ascending?: boolean }) {
    this.ordering.push(
      `${ident(key)} ${options?.ascending === false ? "desc" : "asc"}`,
    );
    return this;
  }
  limit(value: number) {
    this.take = value;
    return this;
  }
  range(start: number, end: number) {
    this.skip = start;
    this.take = end - start + 1;
    return this;
  }
  single() {
    this.cardinality = "one";
    return this;
  }
  maybeSingle() {
    this.cardinality = "optional";
    return this;
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  private async execute(): Promise<Result> {
    try {
      const values: any[] = [];
      const param = (value: any) => {
        values.push(
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : value,
        );
        return `$${values.length}`;
      };
      const columns =
        this.columns === "*"
          ? "*"
          : this.columns
              .split(",")
              .map((column) => ident(column.trim()))
              .join(",");
      const table = `public.${ident(this.table)}`;
      let sql: string;
      if (this.operation === "insert") {
        const keys = Object.keys(this.rows[0]);
        sql = `insert into ${table}(${keys.map(ident)}) values ${this.rows.map((row) => `(${keys.map((key) => param(row[key])).join(",")})`).join(",")}`;
        if (this.conflict)
          sql += ` on conflict (${(this.conflict.onConflict ?? "id").split(",").map(ident)}) ${this.conflict.ignoreDuplicates ? "do nothing" : `do update set ${keys.map((key) => `${ident(key)}=excluded.${ident(key)}`).join(",")}`}`;
      } else if (this.operation === "update")
        sql = `update ${table} set ${Object.entries(this.rows[0])
          .map(([key, value]) => `${ident(key)}=${param(value)}`)
          .join(",")}`;
      else
        sql =
          this.operation === "delete"
            ? `delete from ${table}`
            : `select ${columns} from ${table}`;
      if (this.filters.length)
        sql += ` where ${this.filters.map(([key, operator, value]) => `${ident(key)} ${operator} ${param(value)}`).join(" and ")}`;
      if (this.operation === "select") {
        if (this.ordering.length) sql += ` order by ${this.ordering.join(",")}`;
        sql += ` limit ${param(this.take)} offset ${param(this.skip)}`;
      } else if (this.returning) sql += ` returning ${columns}`;
      const result = await this.query(sql, values);
      if (result.error) return result;
      if (this.cardinality !== "many") {
        if (
          result.data.length > 1 ||
          (this.cardinality === "one" && !result.data.length)
        )
          return {
            data: null,
            error: { code: "PGRST116", message: "Unexpected row count" },
          };
        result.data = result.data[0] ?? null;
      }
      return result;
    } catch (error) {
      return failure(error);
    }
  }
}

type LocalDatabase = Awaited<ReturnType<typeof createLocalDatabase>>;
const singleton = globalThis as typeof globalThis & {
  blueprintLocalDatabase?: Promise<LocalDatabase>;
};
export function localDatabase() {
  if (!localCompanionMode()) throw new Error("local_storage_disabled");
  return (singleton.blueprintLocalDatabase ??= createLocalDatabase(
    path.resolve(
      /* turbopackIgnore: true */
      process.env.BLUEPRINT_LOCAL_DATA_DIR ||
        path.join(process.cwd(), "../../.local/companion"),
    ),
    path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "../../supabase/migrations",
    ),
  ).catch((error) => {
    singleton.blueprintLocalDatabase = undefined;
    throw error;
  }));
}
