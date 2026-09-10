-- Reviewed CLI pull: helper-first triggers, explicit private ACLs; no data backfill.
-- Operator recovery caps are not content licenses. No production policy is seeded.
alter table "public"."resource_adoptions" add column "clear_reason" text;

alter table "public"."resource_adoptions" add column "content_expires_at" timestamp with time zone;

alter table "public"."resource_adoptions" add column "retention_policy_ref" text;

alter table "public"."resource_adoptions" add column "source_started_at" timestamp with time zone;

alter table "public"."resource_runs" add column "clear_reason" text;

alter table "public"."resource_runs" add column "content_expires_at" timestamp with time zone;

alter table "public"."resource_runs" add column "retention_policy_ref" text;

alter table "public"."resource_runs" add column "source_started_at" timestamp with time zone;

CREATE INDEX resource_due_content ON public.resource_runs USING btree (content_expires_at, owner_id) WHERE ((status <> 'cleared'::text) AND (source_run_id IS NULL));

alter table "public"."resource_adoptions" add constraint "resource_adoptions_clear_reason" CHECK (((clear_reason IS NULL) OR ((status = 'cleared'::text) AND (clear_reason = ANY (ARRAY['manual'::text, 'expired'::text]))))) not valid;

alter table "public"."resource_adoptions" validate constraint "resource_adoptions_clear_reason";

alter table "public"."resource_adoptions" add constraint "resource_adoptions_content_lifetime" CHECK ((((source_started_at IS NULL) AND (content_expires_at IS NULL) AND (retention_policy_ref IS NULL)) OR ((source_started_at IS NOT NULL) AND (content_expires_at IS NOT NULL) AND (content_expires_at > source_started_at) AND (retention_policy_ref IS NOT NULL) AND ((length(btrim(retention_policy_ref)) >= 1) AND (length(btrim(retention_policy_ref)) <= 200))))) not valid;

alter table "public"."resource_adoptions" validate constraint "resource_adoptions_content_lifetime";

alter table "public"."resource_runs" add constraint "resource_runs_clear_reason" CHECK (((clear_reason IS NULL) OR ((status = 'cleared'::text) AND (clear_reason = ANY (ARRAY['manual'::text, 'expired'::text]))))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_clear_reason";

alter table "public"."resource_runs" add constraint "resource_runs_content_lifetime" CHECK ((((source_started_at IS NULL) AND (content_expires_at IS NULL) AND (retention_policy_ref IS NULL)) OR ((source_started_at IS NOT NULL) AND (content_expires_at IS NOT NULL) AND (content_expires_at > source_started_at) AND (retention_policy_ref IS NOT NULL) AND ((length(btrim(retention_policy_ref)) >= 1) AND (length(btrim(retention_policy_ref)) <= 200))))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_content_lifetime";


  create policy "resource_adoption_content_live"
  on "public"."resource_adoptions"
  as restrictive
  for select
  to authenticated
using (((status = 'cleared'::text) OR (content_expires_at > clock_timestamp())));



  create policy "resource_content_live"
  on "public"."resource_runs"
  as restrictive
  for select
  to authenticated
using (((status = 'cleared'::text) OR (content_expires_at > clock_timestamp())));



  create table "private"."resource_retention_policies" (
    "owner_id" uuid not null,
    "window_seconds" integer not null,
    "policy_ref" text not null
      );


alter table "private"."resource_retention_policies" enable row level security;

CREATE UNIQUE INDEX resource_retention_policies_pkey ON private.resource_retention_policies USING btree (owner_id);

alter table "private"."resource_retention_policies" add constraint "resource_retention_policies_pkey" PRIMARY KEY using index "resource_retention_policies_pkey";

alter table "private"."resource_retention_policies" add constraint "resource_retention_policies_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."resource_retention_policies" validate constraint "resource_retention_policies_owner_id_fkey";

alter table "private"."resource_retention_policies" add constraint "resource_retention_policies_policy_ref_check" CHECK (((length(btrim(policy_ref)) >= 1) AND (length(btrim(policy_ref)) <= 200))) not valid;

alter table "private"."resource_retention_policies" validate constraint "resource_retention_policies_policy_ref_check";

alter table "private"."resource_retention_policies" add constraint "resource_retention_policies_window_seconds_check" CHECK (((window_seconds >= 1) AND (window_seconds <= 2160000))) not valid;

alter table "private"."resource_retention_policies" validate constraint "resource_retention_policies_window_seconds_check";

CREATE OR REPLACE FUNCTION private.assert_resource_content(p_status text, p_deadline timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if p_status<>'cleared' and (p_deadline is null or p_deadline<=clock_timestamp()) then
  raise exception 'RESOURCE_RETENTION_UNAVAILABLE' using errcode='P0001';
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION private.assign_resource_content_lifetime()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p private.resource_retention_policies; parent public.resource_runs;
begin
 if tg_op='UPDATE' then
  if (new.source_started_at,new.content_expires_at,new.retention_policy_ref) is distinct from
     (old.source_started_at,old.content_expires_at,old.retention_policy_ref) then
   raise exception 'RESOURCE_RETENTION_IMMUTABLE' using errcode='22023';
  end if;
  return new;
 end if;
 if new.source_started_at is not null or new.content_expires_at is not null or new.retention_policy_ref is not null then
  raise exception 'RESOURCE_RETENTION_SERVER_ONLY' using errcode='22023';
 end if;
 if tg_table_name='resource_runs' and new.source_run_id is null then
  select * into p from private.resource_retention_policies where owner_id=new.owner_id;
  if not found then raise exception 'RESOURCE_RETENTION_UNAVAILABLE' using errcode='P0001'; end if;
  new.source_started_at:=clock_timestamp();
  new.content_expires_at:=new.source_started_at+make_interval(secs=>p.window_seconds);
  new.retention_policy_ref:=p.policy_ref;
 else
  select * into parent from public.resource_runs where id=new.source_run_id and owner_id=new.owner_id;
  if not found or parent.content_expires_at is null or parent.content_expires_at<=clock_timestamp() or parent.status='cleared' then
   raise exception 'RESOURCE_RETENTION_UNAVAILABLE' using errcode='P0001';
  end if;
  new.source_started_at:=parent.source_started_at; new.content_expires_at:=parent.content_expires_at; new.retention_policy_ref:=parent.retention_policy_ref;
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.clear_resource_chain(p_owner_id uuid, p_run_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor uuid:=p_owner_id; root_id uuid; chain_ids uuid[]; r public.resource_runs; a public.resource_adoptions; cleared timestamptz;
begin
 if p_owner_id is null or p_reason not in ('manual','expired') or p_reason is null or p_run_id is null then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
 -- Same first lock as every begin/claim/finish/apply; no provider work in this transaction.
 perform 1 from public.blueprints where owner_id=actor for update;
 cleared:=clock_timestamp();
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if r.status='cleared' then return to_jsonb(r); end if;
 with recursive ancestors as (
  select id,source_run_id from public.resource_runs where id=p_run_id and owner_id=actor
  union select parent.id,parent.source_run_id from public.resource_runs parent join ancestors child on parent.id=child.source_run_id where parent.owner_id=actor
 ) select id into root_id from ancestors where source_run_id is null;
 if root_id is null then raise exception 'RESOURCE_INVALID_STATE' using errcode='22023'; end if;
 with recursive descendants as (
  select id from public.resource_runs where id=root_id and owner_id=actor
  union select child.id from public.resource_runs child join descendants parent on child.source_run_id=parent.id where child.owner_id=actor
 ) select array_agg(id order by id) into chain_ids from descendants;
 for r in select * from public.resource_runs where id=any(chain_ids) and owner_id=actor order by id for update loop
  if r.status='queued' then update private.resource_quotas set available_attempts=available_attempts+1 where owner_id=actor and kind=r.kind; end if;
  update public.resource_runs set status='cleared',cleared_at=coalesce(cleared_at,cleared),clear_reason=coalesce(clear_reason,p_reason),preferences=null,learner_context=null,input_blueprint=null,input_discovery=null,skill=null,result=null where id=r.id;
 end loop;
 for a in select * from public.resource_adoptions where source_run_id=any(chain_ids) and owner_id=actor order by id for update loop
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=actor; end if;
  update public.blueprint_proposals set status='rejected',rejected_at=cleared where id=a.proposal_id and owner_id=actor and status='pending';
  update public.resource_adoptions set status='cleared',cleared_at=coalesce(cleared_at,cleared),clear_reason=coalesce(clear_reason,p_reason),video_id=null,result=null where id=a.id;
 end loop;
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.expire_resource_content(p_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare root uuid;
begin
 for root in select id from public.resource_runs where owner_id=p_owner_id and source_run_id is null
  and status<>'cleared' and content_expires_at<=clock_timestamp() order by id loop
  perform private.clear_resource_chain(p_owner_id,root,'expired');
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.sweep_resource_content(p_owner_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; processed integer:=0;
begin
 if p_owner_limit is null or p_owner_limit not between 1 and 1000 then raise exception 'RESOURCE_SWEEP_LIMIT_INVALID' using errcode='22023'; end if;
 for actor in select b.owner_id from public.blueprints b
  where exists(select 1 from public.resource_runs r where r.owner_id=b.owner_id and r.source_run_id is null
   and r.status<>'cleared' and r.content_expires_at<=clock_timestamp())
  order by b.owner_id limit p_owner_limit for update of b skip locked loop
  perform private.expire_resource_content(actor); processed:=processed+1;
 end loop;
 return processed;
end $function$
;

CREATE OR REPLACE FUNCTION private.begin_resource_adoption(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_adoption_web_actor(); a public.resource_adoptions; src public.resource_runs;
 aid uuid; sid uuid; replaceid uuid; video text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or not(p_request ?& array['adoptionId','sourceRunId','videoId','replaceBindingId'])
  or p_request-array['adoptionId','sourceRunId','videoId','replaceBindingId']<>'{}'::jsonb
  or jsonb_typeof(p_request->'adoptionId') is distinct from 'string' or p_request->>'adoptionId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_request->'sourceRunId') is distinct from 'string' or p_request->>'sourceRunId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or jsonb_typeof(p_request->'videoId') is distinct from 'string' or p_request->>'videoId'!~'^[A-Za-z0-9_-]{11}$'
  or (p_request->'replaceBindingId'<>'null'::jsonb and (jsonb_typeof(p_request->'replaceBindingId')<>'string' or p_request->>'replaceBindingId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  then raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 aid:=(p_request->>'adoptionId')::uuid; sid:=(p_request->>'sourceRunId')::uuid; replaceid:=(p_request->>'replaceBindingId')::uuid; video:=p_request->>'videoId';
 perform 1 from public.blueprints where owner_id=actor for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.expire_resource_adoptions(actor);
 select * into a from public.resource_adoptions where id=aid and owner_id=actor for update;
 if found then
  perform private.assert_resource_content(a.status,a.content_expires_at);
  if a.source_run_id<>sid or a.video_id<>video or a.replace_binding_id is distinct from replaceid then raise exception 'RESOURCE_ADOPTION_RUN_REUSED' using errcode='22023'; end if;
  return to_jsonb(a);
 end if;
 if exists(select 1 from public.resource_adoptions where id=aid) then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 select * into src from public.resource_runs where id=sid and owner_id=actor;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 a.owner_id:=actor; a.source_run_id:=sid; a.blueprint_id:=src.blueprint_id; a.blueprint_version:=src.blueprint_version; a.node_id:=src.node_id; a.video_id:=video;
 if not private.resource_adoption_source_current(a) then raise exception 'RESOURCE_ADOPTION_SOURCE_CHANGED' using errcode='40001'; end if;
 if (replaceid is not null and not exists(select 1 from public.resource_bindings where id=replaceid and owner_id=actor and node_id=src.node_id and archived_at is null))
  or exists(select 1 from public.resource_bindings where owner_id=actor and node_id=src.node_id and archived_at is null and external_id=video)
  or (replaceid is null and (select count(*) from public.resource_bindings where owner_id=actor and node_id=src.node_id and archived_at is null)>=16) then
  raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 if exists(select 1 from public.resource_adoptions where owner_id=actor and status in ('queued','running')) then raise exception 'RESOURCE_ADOPTION_BUSY' using errcode='P0001'; end if;
 update private.resource_adoption_quotas set available_attempts=available_attempts-1 where owner_id=actor and available_attempts>0;
 if not found then raise exception 'RESOURCE_ADOPTION_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 insert into public.resource_adoptions(id,owner_id,source_run_id,blueprint_id,blueprint_version,node_id,video_id,replace_binding_id,new_binding_id,status,expires_at)
 values(aid,actor,sid,src.blueprint_id,src.blueprint_version,src.node_id,video,replaceid,gen_random_uuid(),'queued',clock_timestamp()+interval '120 seconds') returning * into a;
 return to_jsonb(a);
exception when unique_violation then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002';
end $function$
;

CREATE OR REPLACE FUNCTION private.begin_resource_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_web_actor(); bp public.blueprints; r public.resource_runs; parent public.resource_runs;
 rid uuid; k text; prefs jsonb; ctx jsonb; snapshot jsonb; discovery jsonb; nid uuid; sourceid uuid;
begin
 if not private.resource_request_valid(p_request) then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
 rid:=(p_request->>'runId')::uuid; k:=p_request->>'kind';
 select * into bp from public.blueprints where owner_id=actor for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 perform private.expire_resource_runs(actor);
 select * into r from public.resource_runs where id=rid and owner_id=actor for update;
 if found then
  perform private.assert_resource_content(r.status,r.content_expires_at);
  if r.kind<>k or (k='discover' and (r.node_id<>(p_request->>'nodeId')::uuid or r.blueprint_version<>(p_request->>'expectedBlueprintVersion')::integer
   or r.preferences<>p_request->'preferences' or r.learner_context<>p_request->'learnerContext'))
   or (k<>'discover' and r.source_run_id<>(p_request->>'sourceRunId')::uuid) then raise exception 'RESOURCE_RUN_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.resource_runs where id=rid) then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if k='discover' then
  if not exists(select 1 from private.resource_retention_policies where owner_id=actor) then raise exception 'RESOURCE_RETENTION_UNAVAILABLE' using errcode='P0001'; end if;
  if bp.version<>(p_request->>'expectedBlueprintVersion')::integer then raise exception 'RESOURCE_VERSION_CONFLICT' using errcode='40001'; end if;
  nid:=(p_request->>'nodeId')::uuid; prefs:=p_request->'preferences'; ctx:=p_request->'learnerContext'; snapshot:=public.read_blueprint_snapshot_v2(actor);
  if not exists(select 1 from jsonb_array_elements(snapshot->'goals') g, jsonb_array_elements(g->'stages') s, jsonb_array_elements(s->'nodes') n where n->>'id'=nid::text and n->>'type'='learn') then
   raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 else
  sourceid:=(p_request->>'sourceRunId')::uuid;
  select * into parent from public.resource_runs where id=sourceid and owner_id=actor for update;
  if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
  perform private.assert_resource_content(parent.status,parent.content_expires_at);
  if parent.status<>'ready' or parent.kind='match' or parent.result->>'status'<>'discovered' or parent.blueprint_version<>bp.version then raise exception 'RESOURCE_INVALID_STATE' using errcode='22023'; end if;
  if exists(select 1 from public.resource_runs where source_run_id=sourceid) then raise exception 'RESOURCE_SOURCE_CONSUMED' using errcode='22023'; end if;
  if (k='captions' and not exists(select 1 from jsonb_array_elements(parent.result->'candidates') c where c#>>'{transcript,status}'='pending'))
   or (k='match' and (exists(select 1 from jsonb_array_elements(parent.result->'candidates') c where c#>>'{transcript,status}'='pending')
   or not exists(select 1 from jsonb_array_elements(parent.result->'candidates') c where c->'eligibleForMatching'='true'::jsonb and c#>>'{transcript,status}'='ready'))) then
   raise exception 'RESOURCE_INVALID_STATE' using errcode='22023'; end if;
  nid:=parent.node_id; prefs:=parent.preferences; ctx:=parent.learner_context; snapshot:=parent.input_blueprint; discovery:=parent.result;
 end if;
 if exists(select 1 from public.resource_runs where owner_id=actor and status in ('queued','running')) then raise exception 'RESOURCE_BUSY' using errcode='P0001'; end if;
 update private.resource_quotas set available_attempts=available_attempts-1 where owner_id=actor and kind=k and available_attempts>0;
 if not found then raise exception 'RESOURCE_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,status,expires_at)
 values(rid,actor,bp.id,bp.version,nid,k,sourceid,prefs,ctx,snapshot,discovery,'queued',clock_timestamp()+interval '120 seconds') returning * into r;
 return to_jsonb(r);
exception when unique_violation then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002';
end $function$
;

CREATE OR REPLACE FUNCTION private.cancel_resource_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_web_actor(); r public.resource_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_runs(actor);
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 perform private.assert_resource_content(r.status,r.content_expires_at);
 if r.status in ('queued','running') then
  if r.status='queued' then update private.resource_quotas set available_attempts=available_attempts+1 where owner_id=actor and kind=r.kind; end if;
  update public.resource_runs set status='cancelled',result='{"status":"cancelled"}' where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.claim_resource_adoption(p_owner_id uuid, p_adoption_id uuid, p_lease_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.resource_adoptions;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_adoption_id is null or p_lease_id is null then raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_adoptions(p_owner_id);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.assert_resource_content(a.status,a.content_expires_at);
 if a.status<>'queued' then return jsonb_build_object('acquired',false,'adoption',to_jsonb(a)); end if;
 insert into private.resource_adoption_leases(adoption_id,lease_id) values(a.id,p_lease_id);
 update public.resource_adoptions set status='running',expires_at=clock_timestamp()+interval '120 seconds' where id=a.id returning * into a;
 return jsonb_build_object('acquired',true,'adoption',to_jsonb(a));
end $function$
;

CREATE OR REPLACE FUNCTION private.claim_resource_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_skill jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.resource_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_runs(p_owner_id);
 select * into r from public.resource_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if r.status='cleared' then return jsonb_build_object('acquired',false,'run',to_jsonb(r)); end if;
 perform private.assert_resource_content(r.status,r.content_expires_at);
 if r.kind='match' then
  if jsonb_typeof(p_skill) is distinct from 'object' or not(p_skill ?& array['name','version','sha256','instructions']) or p_skill-array['name','version','sha256','instructions']<>'{}'::jsonb
   or p_skill->>'name' is distinct from 'blueprint-match-resources' or jsonb_typeof(p_skill->'version') is distinct from 'string' or length(p_skill->>'version')>64 or p_skill->>'version'!~'^[0-9]+\.[0-9]+\.[0-9]+$'
   or jsonb_typeof(p_skill->'sha256') is distinct from 'string' or p_skill->>'sha256'!~'^[0-9a-f]{64}$' or jsonb_typeof(p_skill->'instructions') is distinct from 'string'
   or length(p_skill->>'instructions')+length(regexp_replace(p_skill->>'instructions',U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 32000
   or encode(sha256(convert_to(p_skill->>'instructions','UTF8')),'hex')<>p_skill->>'sha256' then raise exception 'RESOURCE_INVALID_SKILL' using errcode='22023'; end if;
 elsif p_skill is not null and p_skill<>'null'::jsonb then raise exception 'RESOURCE_INVALID_SKILL' using errcode='22023'; end if;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r)); end if;
 insert into private.resource_leases(run_id,lease_id) values(r.id,p_lease_id);
 update public.resource_runs set status='running',skill=case when r.kind='match' then p_skill else null end,expires_at=clock_timestamp()+interval '120 seconds' where id=r.id returning * into r;
 return jsonb_build_object('acquired',true,'run',to_jsonb(r));
end $function$
;

CREATE OR REPLACE FUNCTION private.clear_resource_evidence(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_web_actor();
begin return private.clear_resource_chain(actor,p_run_id,'manual'); end $function$
;

CREATE OR REPLACE FUNCTION private.expire_resource_adoptions(p_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.resource_adoptions;
begin
 perform private.expire_resource_content(p_owner_id);
 for a in select * from public.resource_adoptions where owner_id=p_owner_id and status in ('queued','running') and expires_at<=clock_timestamp() order by id for update loop
  update public.resource_adoptions set status=case when a.status='queued' then 'cancelled' else 'interrupted' end,
   result=jsonb_build_object('status',case when a.status='queued' then 'cancelled' else 'timed_out' end) where id=a.id;
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id; end if;
 end loop;
 for a in select pending.* from public.resource_adoptions pending where pending.owner_id=p_owner_id and pending.status in ('queued','running')
  and not private.resource_adoption_source_current(pending) order by pending.id for update loop
  update public.resource_adoptions set status='stale',result='{"status":"invalid_input"}' where id=a.id;
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id; end if;
 end loop;
 update public.resource_adoptions ready set status='stale' where ready.owner_id=p_owner_id and ready.status='ready'
  and (ready.valid_until<=clock_timestamp() or not private.resource_adoption_source_current(ready));
end $function$
;

CREATE OR REPLACE FUNCTION private.expire_resource_runs(p_owner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.resource_runs;
begin
 perform private.expire_resource_content(p_owner_id);
 for r in select * from public.resource_runs where owner_id=p_owner_id and status in ('queued','running')
  and expires_at<=clock_timestamp() order by id for update loop
  update public.resource_runs set status=case when r.status='queued' then 'cancelled' else 'interrupted' end,
   result=jsonb_build_object('status',case when r.status='queued' then 'cancelled' else 'timed_out' end) where id=r.id;
  if r.status='queued' then update private.resource_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id and kind=r.kind; end if;
 end loop;
 for r in select pending.* from public.resource_runs pending where pending.owner_id=p_owner_id and pending.status='queued'
  and not exists(select 1 from public.blueprints b where b.id=pending.blueprint_id and b.owner_id=p_owner_id and b.version=pending.blueprint_version)
  order by pending.id for update loop
  update public.resource_runs set status='failed',result='{"status":"invalid_input"}' where id=r.id;
  update private.resource_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id and kind=r.kind;
 end loop;
 update public.resource_runs completed set status='stale' where completed.owner_id=p_owner_id and completed.status='ready'
  and not exists(select 1 from public.blueprints b where b.id=completed.blueprint_id and b.owner_id=p_owner_id and b.version=completed.blueprint_version);
end $function$
;

CREATE OR REPLACE FUNCTION private.finish_resource_adoption(p_owner_id uuid, p_adoption_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.resource_adoptions; lease private.resource_adoption_leases; digest bytea; draft jsonb; proposal public.blueprint_proposals; verified timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_adoption_id is null or p_lease_id is null then raise exception 'RESOURCE_ADOPTION_INVALID_RESULT' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_adoptions(p_owner_id);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.resource_adoption_leases where adoption_id=a.id for update;
 if not found or lease.lease_id<>p_lease_id then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 if a.status='cleared' then return to_jsonb(a); end if;
 perform private.assert_resource_content(a.status,a.content_expires_at);
 if not private.resource_adoption_result_valid(p_result) then raise exception 'RESOURCE_ADOPTION_INVALID_RESULT' using errcode='22023'; end if;
 if p_result->>'status'='verified' and p_result#>>'{video,videoId}' is distinct from a.video_id then raise exception 'RESOURCE_ADOPTION_INVALID_RESULT' using errcode='22023'; end if;
 digest:=sha256(convert_to(p_result::text,'UTF8'));
 if lease.completion_digest is not null then
  if lease.completion_digest<>digest then raise exception 'RESOURCE_ADOPTION_COMPLETION_REUSED' using errcode='22023'; end if;
  return to_jsonb(a);
 end if;
 if a.status in ('cancelled','interrupted','stale') then update private.resource_adoption_leases set completion_digest=digest where adoption_id=a.id; return to_jsonb(a); end if;
 if a.status<>'running' then raise exception 'RESOURCE_ADOPTION_INVALID_STATE' using errcode='22023'; end if;
 if not private.resource_adoption_source_current(a) then update public.resource_adoptions set status='stale',result=p_result where id=a.id returning * into a;
 elsif p_result->>'status'='verified' then
  draft:=private.resource_adoption_draft(a);
  if draft is null then raise exception 'RESOURCE_ADOPTION_INVALID_RESULT' using errcode='22023'; end if;
  verified:=clock_timestamp();
  insert into public.blueprint_proposals(owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
   values(a.owner_id,a.blueprint_id,a.blueprint_version,draft,gen_random_uuid()) returning * into proposal;
  update public.resource_adoptions set status='ready',result=p_result,verified_at=verified,valid_until=verified+interval '10 minutes',proposal_id=proposal.id where id=a.id returning * into a;
 else update public.resource_adoptions set status=case when p_result->>'status'='cancelled' then 'cancelled' else 'failed' end,result=p_result where id=a.id returning * into a;
 end if;
 update private.resource_adoption_leases set completion_digest=digest where adoption_id=a.id;
 return to_jsonb(a);
end $function$
;

CREATE OR REPLACE FUNCTION private.finish_resource_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.resource_runs; lease private.resource_leases; fingerprint bytea; nextstatus text; bp public.blueprints;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
 select * into bp from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_runs(p_owner_id);
 select * into r from public.resource_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.resource_leases where run_id=r.id for update;
 if not found or lease.lease_id<>p_lease_id then raise exception 'RESOURCE_FORBIDDEN' using errcode='42501'; end if;
 if r.status='cleared' then return to_jsonb(r); end if;
 perform private.assert_resource_content(r.status,r.content_expires_at);
 if not private.resource_result_valid(r,p_result) then raise exception 'RESOURCE_INVALID_RESULT' using errcode='22023'; end if;
 fingerprint:=sha256(convert_to(p_result::text,'UTF8'));
 if lease.completion_digest is not null then
  if lease.completion_digest<>fingerprint then raise exception 'RESOURCE_COMPLETION_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 if r.status in ('cancelled','interrupted') then
  update private.resource_leases set completion_digest=fingerprint where run_id=r.id;
  return to_jsonb(r);
 end if;
 if r.status<>'running' then raise exception 'RESOURCE_INVALID_STATE' using errcode='22023'; end if;
 nextstatus:=case when p_result->>'status' in ('discovered','no_candidates','matched','no_match','no_evidence') then 'ready' when p_result->>'status'='cancelled' then 'cancelled' else 'failed' end;
 if nextstatus='ready' and bp.version<>r.blueprint_version then nextstatus:='stale'; end if;
 update private.resource_leases set completion_digest=fingerprint where run_id=r.id;
 update public.resource_runs set result=p_result,status=nextstatus where id=r.id returning * into r;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.read_resource_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_web_actor(); r public.resource_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_runs(actor);
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 perform private.assert_resource_content(r.status,r.content_expires_at);
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.resource_adoption_operation(p_adoption_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_adoption_web_actor(); a public.resource_adoptions; proposal public.blueprint_proposals;
begin
 if p_adoption_id is null or p_action not in ('read','cancel','reject') then raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_adoptions(actor);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=actor for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.assert_resource_content(a.status,a.content_expires_at);
 if p_action='cancel' and a.status in ('queued','running') then
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=actor; end if;
  update public.resource_adoptions set status='cancelled',result='{"status":"cancelled"}' where id=a.id returning * into a;
 elsif p_action='reject' then
  if a.status='applied' then raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514'; end if;
  if a.status not in ('ready','stale','rejected') or a.proposal_id is null then raise exception 'RESOURCE_ADOPTION_INVALID_STATE' using errcode='22023'; end if;
  select * into proposal from public.blueprint_proposals where id=a.proposal_id and owner_id=actor for update;
  if not found or proposal.status='applied' then raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514'; end if;
  if proposal.status='pending' then update public.blueprint_proposals set status='rejected',rejected_at=clock_timestamp() where id=proposal.id; end if;
  update public.resource_adoptions set status='rejected' where id=a.id returning * into a;
 end if;
 return to_jsonb(a);
end $function$
;

CREATE OR REPLACE FUNCTION private.resource_adoption_source_current(a public.resource_adoptions)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.resource_runs r join public.blueprints bp on bp.id=r.blueprint_id and bp.owner_id=r.owner_id
  where r.id=a.source_run_id and r.owner_id=a.owner_id and r.blueprint_id=a.blueprint_id and r.blueprint_version=a.blueprint_version
   and (a.id is null or a.content_expires_at>clock_timestamp()) and r.content_expires_at>clock_timestamp() and bp.version=a.blueprint_version and r.node_id=a.node_id and r.kind='match' and r.status='ready' and r.result->>'status'='matched'
   and exists(select 1 from jsonb_array_elements(r.result->'assessments') x where x->>'videoId'=a.video_id and x->>'role' in ('recommended','alternative'))
   and exists(select 1 from jsonb_array_elements(r.input_discovery->'candidates') c where c#>>'{video,videoId}'=a.video_id and c->'eligibleForMatching'='true'::jsonb and c#>>'{transcript,status}'='ready')
   and exists(select 1 from public.path_nodes n join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
    where n.id=a.node_id and n.owner_id=a.owner_id and n.node_type='learn' and n.archived_at is null and s.archived_at is null and g.archived_at is null and g.blueprint_id=a.blueprint_id))
$function$
;

revoke all on private.resource_retention_policies from public,anon,authenticated,service_role;
revoke all on function private.assert_resource_content(text,timestamptz),
 private.assign_resource_content_lifetime(),private.clear_resource_chain(uuid,uuid,text),
 private.expire_resource_content(uuid),private.sweep_resource_content(integer) from public,anon,authenticated,service_role;
CREATE TRIGGER resource_adoption_content_lifetime BEFORE INSERT OR UPDATE ON public.resource_adoptions FOR EACH ROW EXECUTE FUNCTION private.assign_resource_content_lifetime();
CREATE TRIGGER resource_run_content_lifetime BEFORE INSERT OR UPDATE ON public.resource_runs FOR EACH ROW EXECUTE FUNCTION private.assign_resource_content_lifetime();
