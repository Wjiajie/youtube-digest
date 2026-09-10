-- Reviewed local CLI pull: additive operator-only aggregate state and invoker
-- entrypoints. No existing content, policy, sweep function or schedule changes.
  create table "private"."resource_maintenance_state" (
    "singleton" boolean not null default true,
    "last_attempt_at" timestamp with time zone not null,
    "last_finished_at" timestamp with time zone not null,
    "last_success_at" timestamp with time zone,
    "last_status" text not null,
    "last_error_code" text,
    "last_duration_ms" double precision not null,
    "last_processed_owners" integer,
    "success_count" bigint not null default 0,
    "failure_count" bigint not null default 0
      );


alter table "private"."resource_maintenance_state" enable row level security;

CREATE UNIQUE INDEX resource_maintenance_state_pkey ON private.resource_maintenance_state USING btree (singleton);

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_pkey" PRIMARY KEY using index "resource_maintenance_state_pkey";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_check" CHECK ((((last_status = 'succeeded'::text) AND (last_error_code IS NULL) AND (last_processed_owners IS NOT NULL) AND (last_success_at IS NOT NULL)) OR ((last_status = 'failed'::text) AND (last_error_code IS NOT NULL) AND (last_processed_owners IS NULL)))) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_failure_count_check" CHECK ((failure_count >= 0)) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_failure_count_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_last_duration_ms_check" CHECK (((last_duration_ms >= (0)::double precision) AND (last_duration_ms < 'Infinity'::double precision))) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_last_duration_ms_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_last_error_code_check" CHECK ((last_error_code ~ '^[0-9A-Z]{5}$'::text)) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_last_error_code_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_last_processed_owners_check" CHECK (((last_processed_owners >= 0) AND (last_processed_owners <= 1000))) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_last_processed_owners_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_last_status_check" CHECK ((last_status = ANY (ARRAY['succeeded'::text, 'failed'::text]))) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_last_status_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_singleton_check" CHECK (singleton) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_singleton_check";

alter table "private"."resource_maintenance_state" add constraint "resource_maintenance_state_success_count_check" CHECK ((success_count >= 0)) not valid;

alter table "private"."resource_maintenance_state" validate constraint "resource_maintenance_state_success_count_check";

CREATE OR REPLACE FUNCTION private.resource_maintenance_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare observed timestamptz:=clock_timestamp(); overdue bigint; oldest timestamptz; state private.resource_maintenance_state;
begin
 select count(*),min(content_expires_at) into overdue,oldest from public.resource_runs
 where kind='discover' and source_run_id is null and status<>'cleared'
  and source_started_at is not null and retention_policy_ref is not null and content_expires_at<=observed;
 select * into state from private.resource_maintenance_state where singleton;
 return jsonb_build_object('version',1,'observed_at',observed,'overdue_roots',overdue,'oldest_overdue_at',oldest,
  'last_attempt_at',state.last_attempt_at,'last_finished_at',state.last_finished_at,'last_success_at',state.last_success_at,
  'last_status',coalesce(state.last_status,'never_run'),'last_error_code',state.last_error_code,
  'last_duration_ms',state.last_duration_ms,'last_processed_owners',state.last_processed_owners,
  'success_count',coalesce(state.success_count,0),'failure_count',coalesce(state.failure_count,0));
end $function$
;

CREATE OR REPLACE FUNCTION private.run_resource_maintenance(p_owner_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare started timestamptz; finished timestamptz; duration double precision; processed integer;
 outcome text:='succeeded'; error_code text;
begin
 if p_owner_limit is null or p_owner_limit not between 1 and 1000 then
  raise exception 'RESOURCE_SWEEP_LIMIT_INVALID' using errcode='22023';
 end if;
 -- Fixed two-int namespace, transaction scoped. Busy never overwrites the last receipt.
 if not pg_try_advisory_xact_lock(667210,1) then
  return jsonb_build_object('status','busy','observed_at',clock_timestamp(),'processed_owners',null,'error_code',null,'duration_ms',null);
 end if;
 started:=clock_timestamp();
 begin
  processed:=private.sweep_resource_content(p_owner_limit);
 exception when others then
  -- The sweep subtransaction has rolled back. Never retain SQLERRM, detail or context.
  get stacked diagnostics error_code=returned_sqlstate;
  outcome:='failed'; processed:=null;
 end;
 finished:=clock_timestamp(); duration:=greatest(0,extract(epoch from finished-started)*1000);
 insert into private.resource_maintenance_state(singleton,last_attempt_at,last_finished_at,last_success_at,last_status,last_error_code,last_duration_ms,last_processed_owners,success_count,failure_count)
 values(true,started,finished,case when outcome='succeeded' then finished end,outcome,error_code,duration,processed,
  case when outcome='succeeded' then 1 else 0 end,case when outcome='failed' then 1 else 0 end)
 on conflict(singleton) do update set last_attempt_at=excluded.last_attempt_at,last_finished_at=excluded.last_finished_at,
  last_success_at=coalesce(excluded.last_success_at,private.resource_maintenance_state.last_success_at),last_status=excluded.last_status,
  last_error_code=excluded.last_error_code,last_duration_ms=excluded.last_duration_ms,last_processed_owners=excluded.last_processed_owners,
  success_count=private.resource_maintenance_state.success_count+excluded.success_count,
  failure_count=private.resource_maintenance_state.failure_count+excluded.failure_count;
 return jsonb_build_object('status',outcome,'observed_at',finished,'processed_owners',processed,'error_code',error_code,'duration_ms',duration);
end $function$
;

-- CLI schema diff omits revoked default function execution; retain the tested
-- explicit denial for every application role on a clean installation too.
revoke all on private.resource_maintenance_state from public, anon, authenticated, service_role;
revoke all on function private.resource_maintenance_snapshot() from public, anon, authenticated, service_role;
revoke all on function private.run_resource_maintenance(integer) from public, anon, authenticated, service_role;
