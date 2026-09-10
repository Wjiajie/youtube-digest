-- Reviewed CLI pull. Response-only database time on all claim returns.
-- CREATE OR REPLACE retains existing function identities and privileges;
-- no persisted row, deadline, lease, policy or quota is rewritten by this migration.

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
 if a.status<>'queued' then return jsonb_build_object('acquired',false,'adoption',to_jsonb(a),'observed_at',clock_timestamp()); end if;
 insert into private.resource_adoption_leases(adoption_id,lease_id) values(a.id,p_lease_id);
 update public.resource_adoptions set status='running',expires_at=clock_timestamp()+interval '120 seconds' where id=a.id returning * into a;
 return jsonb_build_object('acquired',true,'adoption',to_jsonb(a),'observed_at',clock_timestamp());
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
 if r.status='cleared' then return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp()); end if;
 perform private.assert_resource_content(r.status,r.content_expires_at);
 if r.kind='match' then
  if jsonb_typeof(p_skill) is distinct from 'object' or not(p_skill ?& array['name','version','sha256','instructions']) or p_skill-array['name','version','sha256','instructions']<>'{}'::jsonb
   or p_skill->>'name' is distinct from 'blueprint-match-resources' or jsonb_typeof(p_skill->'version') is distinct from 'string' or length(p_skill->>'version')>64 or p_skill->>'version'!~'^[0-9]+\.[0-9]+\.[0-9]+$'
   or jsonb_typeof(p_skill->'sha256') is distinct from 'string' or p_skill->>'sha256'!~'^[0-9a-f]{64}$' or jsonb_typeof(p_skill->'instructions') is distinct from 'string'
   or length(p_skill->>'instructions')+length(regexp_replace(p_skill->>'instructions',U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 32000
   or encode(sha256(convert_to(p_skill->>'instructions','UTF8')),'hex')<>p_skill->>'sha256' then raise exception 'RESOURCE_INVALID_SKILL' using errcode='22023'; end if;
 elsif p_skill is not null and p_skill<>'null'::jsonb then raise exception 'RESOURCE_INVALID_SKILL' using errcode='22023'; end if;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp()); end if;
 insert into private.resource_leases(run_id,lease_id) values(r.id,p_lease_id);
 update public.resource_runs set status='running',skill=case when r.kind='match' then p_skill else null end,expires_at=clock_timestamp()+interval '120 seconds' where id=r.id returning * into r;
 return jsonb_build_object('acquired',true,'run',to_jsonb(r),'observed_at',clock_timestamp());
end $function$
;
