-- Reviewed local CLI pull; schema-only upgrade, explicit ACLs and helper-first ordering.
-- Clearing runs only on an authenticated owner's explicit public RPC call.
alter table "public"."resource_adoptions" drop constraint "resource_adoptions_check";

alter table "public"."resource_adoptions" drop constraint "resource_adoptions_status_check";

alter table "public"."resource_runs" drop constraint "resource_runs_check1";

alter table "public"."resource_runs" drop constraint "resource_runs_check2";

alter table "public"."resource_runs" drop constraint "resource_runs_status_check";

alter table "public"."resource_adoptions" add column "cleared_at" timestamp with time zone;

alter table "public"."resource_adoptions" alter column "video_id" drop not null;

alter table "public"."resource_runs" add column "cleared_at" timestamp with time zone;

alter table "public"."resource_runs" alter column "input_blueprint" drop not null;

alter table "public"."resource_runs" alter column "learner_context" drop not null;

alter table "public"."resource_runs" alter column "preferences" drop not null;

alter table "public"."resource_adoptions" add constraint "resource_adoptions_cleared_payload" CHECK ((((status = 'cleared'::text) AND (cleared_at IS NOT NULL) AND (video_id IS NULL) AND (result IS NULL)) OR ((status <> 'cleared'::text) AND (cleared_at IS NULL) AND (video_id IS NOT NULL)))) not valid;

alter table "public"."resource_adoptions" validate constraint "resource_adoptions_cleared_payload";

alter table "public"."resource_runs" add constraint "resource_runs_cleared_payload" CHECK ((((status = 'cleared'::text) AND (cleared_at IS NOT NULL) AND (preferences IS NULL) AND (learner_context IS NULL) AND (input_blueprint IS NULL) AND (input_discovery IS NULL) AND (skill IS NULL) AND (result IS NULL)) OR ((status <> 'cleared'::text) AND (cleared_at IS NULL) AND (preferences IS NOT NULL) AND (learner_context IS NOT NULL) AND (input_blueprint IS NOT NULL)))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_cleared_payload";

alter table "public"."resource_adoptions" add constraint "resource_adoptions_check" CHECK (((status = 'cleared'::text) OR ((status = ANY (ARRAY['queued'::text, 'running'::text])) = (result IS NULL)))) not valid;

alter table "public"."resource_adoptions" validate constraint "resource_adoptions_check";

alter table "public"."resource_adoptions" add constraint "resource_adoptions_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text, 'stale'::text, 'applied'::text, 'rejected'::text, 'cleared'::text]))) not valid;

alter table "public"."resource_adoptions" validate constraint "resource_adoptions_status_check";

alter table "public"."resource_runs" add constraint "resource_runs_check1" CHECK (((status = 'cleared'::text) OR ((kind = 'discover'::text) = (input_discovery IS NULL)))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_check1";

alter table "public"."resource_runs" add constraint "resource_runs_check2" CHECK (((status = 'cleared'::text) OR ((status = ANY (ARRAY['queued'::text, 'running'::text])) = (result IS NULL)))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_check2";

alter table "public"."resource_runs" add constraint "resource_runs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text, 'stale'::text, 'cleared'::text]))) not valid;

alter table "public"."resource_runs" validate constraint "resource_runs_status_check";

CREATE OR REPLACE FUNCTION private.clear_resource_evidence(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.resource_web_actor(); root_id uuid; chain_ids uuid[]; r public.resource_runs; a public.resource_adoptions; cleared timestamptz;
begin
 if p_run_id is null then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
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
  update public.resource_runs set status='cleared',cleared_at=coalesce(cleared_at,cleared),preferences=null,learner_context=null,input_blueprint=null,input_discovery=null,skill=null,result=null where id=r.id;
 end loop;
 for a in select * from public.resource_adoptions where source_run_id=any(chain_ids) and owner_id=actor order by id for update loop
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=actor; end if;
  update public.blueprint_proposals set status='rejected',rejected_at=cleared where id=a.proposal_id and owner_id=actor and status='pending';
  update public.resource_adoptions set status='cleared',cleared_at=coalesce(cleared_at,cleared),video_id=null,result=null where id=a.id;
 end loop;
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor;
 return to_jsonb(r);
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

revoke all on function private.clear_resource_evidence(uuid), private.claim_resource_run(uuid,uuid,uuid,jsonb),
 private.finish_resource_run(uuid,uuid,uuid,jsonb), private.finish_resource_adoption(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.clear_resource_evidence(uuid) to authenticated;
grant execute on function private.claim_resource_run(uuid,uuid,uuid,jsonb),private.finish_resource_run(uuid,uuid,uuid,jsonb),
 private.finish_resource_adoption(uuid,uuid,uuid,jsonb) to service_role;
create function public.clear_resource_evidence(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.clear_resource_evidence(p_run_id)$$;
revoke all on function public.clear_resource_evidence(uuid) from public,anon,authenticated,service_role;
grant execute on function public.clear_resource_evidence(uuid) to authenticated;
