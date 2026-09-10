-- Reviewed local CLI diff: omit unrelated pg_net DROP; retain dependency ordering and explicit ACLs.
-- Durable resource operations. Providers execute outside these short transactions.
create table public.resource_runs (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 blueprint_id uuid not null, blueprint_version integer not null check(blueprint_version>=0), node_id uuid not null,
 kind text not null check(kind in ('discover','captions','match')),
 source_run_id uuid unique references public.resource_runs(id) on delete cascade,
 preferences jsonb not null, learner_context jsonb not null, input_blueprint jsonb not null, input_discovery jsonb,
 skill jsonb, result jsonb, status text not null check(status in ('queued','running','ready','failed','cancelled','interrupted','stale')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 foreign key(blueprint_id,owner_id) references public.blueprints(id,owner_id) on delete cascade,
 check((kind='discover')=(source_run_id is null)), check((kind='discover')=(input_discovery is null)),
 check((status in ('queued','running'))=(result is null)),
 check(kind='match' or skill is null), check(status<>'queued' or skill is null),
 check(status<>'running' or kind<>'match' or skill is not null)
);
create unique index resource_one_active_owner on public.resource_runs(owner_id) where status in ('queued','running');
create index resource_owner_recent on public.resource_runs(owner_id,created_at desc,id desc);
create index resource_blueprint_owner on public.resource_runs(blueprint_id,owner_id);
alter table public.resource_runs enable row level security;
revoke all on public.resource_runs from public,anon,authenticated,service_role;
grant select on public.resource_runs to authenticated;
create policy resource_web_owner_read on public.resource_runs for select to authenticated
 using((select auth.uid())=owner_id and not(select private.is_extension_client())
 and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);
create table private.resource_quotas (
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('discover','captions','match')),
 available_attempts integer not null check(available_attempts>=0), primary key(owner_id,kind)
);
create table private.resource_leases (
 run_id uuid primary key references public.resource_runs(id) on delete cascade,
 lease_id uuid not null, completion_digest bytea
);
alter table private.resource_quotas enable row level security;
alter table private.resource_leases enable row level security;
revoke all on private.resource_quotas,private.resource_leases from public,anon,authenticated,service_role;
grant select,insert,update on private.resource_quotas to service_role;

create function private.resource_web_actor() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then
  raise exception 'RESOURCE_FORBIDDEN' using errcode='42501';
 end if;
 return auth.uid();
end $$;

-- Blueprint lock must already be held. Expiration never launches network work.
create function private.expire_resource_runs(p_owner_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.resource_runs;
begin
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
end $$;

create function private.resource_request_valid(v jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare prefs jsonb; ctx jsonb; k text;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>32768
  or jsonb_typeof(v->'runId') is distinct from 'string' or v->>'runId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then return false; end if;
 if v->>'kind' in ('captions','match') then
  return coalesce(v-array['kind','runId','sourceRunId']='{}'::jsonb and jsonb_typeof(v->'sourceRunId')='string'
   and v->>'sourceRunId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false);
 end if;
 if v->>'kind' is distinct from 'discover' or not(v ?& array['kind','runId','nodeId','expectedBlueprintVersion','preferences','learnerContext'])
  or v-array['kind','runId','nodeId','expectedBlueprintVersion','preferences','learnerContext']<>'{}'::jsonb
  or jsonb_typeof(v->'nodeId') is distinct from 'string' or v->>'nodeId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(v->'expectedBlueprintVersion') is distinct from 'number' or (v->>'expectedBlueprintVersion')::numeric not between 0 and 2147483647
  or mod((v->>'expectedBlueprintVersion')::numeric,1)<>0 then return false; end if;
 prefs:=v->'preferences'; ctx:=v->'learnerContext';
 if jsonb_typeof(prefs) is distinct from 'object' or not(prefs ?& array['regionCode','language','allowLanguageFallback','maxDurationSeconds','publishedAfter'])
  or prefs-array['regionCode','language','allowLanguageFallback','maxDurationSeconds','publishedAfter']<>'{}'::jsonb
  or jsonb_typeof(prefs->'regionCode') is distinct from 'string' or prefs->>'regionCode'!~'^[A-Z]{2}$'
  or jsonb_typeof(prefs->'language') is distinct from 'string' or prefs->>'language'!~'^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'
  or jsonb_typeof(prefs->'allowLanguageFallback') is distinct from 'boolean'
  or jsonb_typeof(prefs->'maxDurationSeconds') is distinct from 'number'
  or (prefs->>'maxDurationSeconds')::numeric not between 1 and 86400 or mod((prefs->>'maxDurationSeconds')::numeric,1)<>0 then return false; end if;
 if prefs->'publishedAfter'<>'null'::jsonb then
  if jsonb_typeof(prefs->'publishedAfter')<>'string' or prefs->>'publishedAfter'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
  perform (prefs->>'publishedAfter')::timestamptz;
 end if;
 if jsonb_typeof(ctx) is distinct from 'object' or not(ctx ?& array['startingPoint','constraints']) or ctx-array['startingPoint','constraints']<>'{}'::jsonb then return false; end if;
 foreach k in array array['startingPoint','constraints'] loop
  if ctx->k<>'null'::jsonb and (jsonb_typeof(ctx->k)<>'string' or length(ctx->>k)+length(regexp_replace(ctx->>k,U&'[^\+010000-\+10FFFF]','','g'))>2000) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function private.begin_resource_run(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if r.kind<>k or (k='discover' and (r.node_id<>(p_request->>'nodeId')::uuid or r.blueprint_version<>(p_request->>'expectedBlueprintVersion')::integer
   or r.preferences<>p_request->'preferences' or r.learner_context<>p_request->'learnerContext'))
   or (k<>'discover' and r.source_run_id<>(p_request->>'sourceRunId')::uuid) then raise exception 'RESOURCE_RUN_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.resource_runs where id=rid) then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if k='discover' then
  if bp.version<>(p_request->>'expectedBlueprintVersion')::integer then raise exception 'RESOURCE_VERSION_CONFLICT' using errcode='40001'; end if;
  nid:=(p_request->>'nodeId')::uuid; prefs:=p_request->'preferences'; ctx:=p_request->'learnerContext'; snapshot:=public.read_blueprint_snapshot_v2(actor);
  if not exists(select 1 from jsonb_array_elements(snapshot->'goals') g, jsonb_array_elements(g->'stages') s, jsonb_array_elements(s->'nodes') n where n->>'id'=nid::text and n->>'type'='learn') then
   raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 else
  sourceid:=(p_request->>'sourceRunId')::uuid;
  select * into parent from public.resource_runs where id=sourceid and owner_id=actor for update;
  if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
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
end $$;

create function private.read_resource_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.resource_web_actor(); r public.resource_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_runs(actor);
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 return to_jsonb(r);
end $$;
create function private.cancel_resource_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.resource_web_actor(); r public.resource_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_runs(actor);
 select * into r from public.resource_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if r.status in ('queued','running') then
  if r.status='queued' then update private.resource_quotas set available_attempts=available_attempts+1 where owner_id=actor and kind=r.kind; end if;
  update public.resource_runs set status='cancelled',result='{"status":"cancelled"}' where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $$;

create function private.claim_resource_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resource_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'RESOURCE_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_runs(p_owner_id);
 select * into r from public.resource_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_NOT_FOUND' using errcode='P0002'; end if;
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
end $$;

create function private.resource_result_valid(r public.resource_runs,v jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb; oldc jsonb; s text; ids text[]:='{}'; jobs text[]:='{}';
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>4194304 or jsonb_typeof(v->'status') is distinct from 'string' then return false; end if;
 s:=v->>'status';
 if s in ('invalid_input','not_applicable','unavailable','rate_limited','cancelled','timed_out','not_found','invalid_output') then
  return v-array['status','requests','providerMayHaveRun','usage']='{}'::jsonb;
 end if;
 if r.kind='match' and s='no_evidence' then return v-array['status','providerMayHaveRun','usage']='{}'::jsonb; end if;
 if (r.kind='match' and s not in ('matched','no_match')) or (r.kind<>'match' and s not in ('discovered','no_candidates')) then return false; end if;
 if jsonb_typeof(v->'source') is distinct from 'object' or v#>>'{source,blueprintId}' is distinct from r.blueprint_id::text
  or v#>'{source,blueprintVersion}' is distinct from to_jsonb(r.blueprint_version) or v#>>'{source,nodeId}' is distinct from r.node_id::text
  or jsonb_typeof(v#>'{source,checkedAt}') is distinct from 'string' then return false; end if;
 perform (v#>>'{source,checkedAt}')::timestamptz;
 if r.kind='match' then
  return coalesce(v-array['status','reviewRequired','providerMayHaveRun','usage','source','skill','summary','assessments','coverage']='{}'::jsonb
   and v->'reviewRequired'='true'::jsonb and v->'skill'=(r.skill-'instructions')
   and (v->'source')-'evidenceSha256'=r.input_discovery->'source' and v#>>'{source,evidenceSha256}'~'^[0-9a-f]{64}$'
   and jsonb_typeof(v->'assessments')='array' and jsonb_array_length(v->'assessments') between 1 and 3
   and not exists(select 1 from jsonb_array_elements(v->'assessments') a where not exists(
    select 1 from jsonb_array_elements(r.input_discovery->'candidates') candidate
    where candidate#>>'{video,videoId}'=a->>'videoId' and candidate->'eligibleForMatching'='true'::jsonb and candidate#>>'{transcript,status}'='ready'))
   and (select count(distinct a->>'videoId') from jsonb_array_elements(v->'assessments') a)=jsonb_array_length(v->'assessments')
   and jsonb_typeof(v->'coverage')='array' and jsonb_typeof(v->'summary')='string',false);
 end if;
 if (v->'source')-array['blueprintId','blueprintVersion','nodeId','checkedAt']<>'{}'::jsonb
  or not(v ?& array['requests','rejected']) or jsonb_typeof(v->'requests')<>'object' or jsonb_typeof(v->'rejected')<>'array' then return false; end if;
 if s='no_candidates' then return r.kind='discover' and v-array['status','source','requests','rejected']='{}'::jsonb; end if;
 if v-array['status','source','requests','candidates','rejected','uninspectedVideoIds']<>'{}'::jsonb or jsonb_typeof(v->'candidates') is distinct from 'array'
  or jsonb_array_length(v->'candidates') not between 1 and 3 or jsonb_typeof(v->'uninspectedVideoIds') is distinct from 'array' then return false; end if;
 if r.kind='captions' and (v-array['candidates']<>r.input_discovery-array['candidates'] or jsonb_array_length(v->'candidates')<>jsonb_array_length(r.input_discovery->'candidates')) then return false; end if;
 for c in select * from jsonb_array_elements(v->'candidates') loop
  if jsonb_typeof(c#>'{video,videoId}') is distinct from 'string' or c#>>'{video,videoId}'!~'^[A-Za-z0-9_-]{11}$' or c#>>'{video,videoId}'=any(ids)
   or c->>'url' is distinct from 'https://www.youtube.com/watch?v='||(c#>>'{video,videoId}') or c->>'matching' is distinct from 'not_evaluated'
   or jsonb_typeof(c->'eligibleForMatching') is distinct from 'boolean' or jsonb_typeof(c->'transcript') is distinct from 'object'
   or jsonb_typeof(c#>'{transcript,status}') is distinct from 'string'
   or c#>>'{transcript,status}' not in ('ready','pending','invalid_input','unavailable','rate_limited','cancelled','timed_out','not_found') then return false; end if;
  ids:=array_append(ids,c#>>'{video,videoId}');
  if c#>>'{transcript,status}'='pending' and (jsonb_typeof(c#>'{transcript,jobId}') is distinct from 'string' or length(c#>>'{transcript,jobId}') not between 1 and 200) then return false; end if;
  if c#>>'{transcript,status}'='pending' then
   if c#>>'{transcript,jobId}'=any(jobs) then return false; end if;
   jobs:=array_append(jobs,c#>>'{transcript,jobId}');
  end if;
  if r.kind='captions' then
   select x into oldc from jsonb_array_elements(r.input_discovery->'candidates') x where x#>>'{video,videoId}'=c#>>'{video,videoId}';
   if not found then return false; end if;
   if oldc#>>'{transcript,status}'<>'pending' and c<>oldc then return false; end if;
   if c-array['transcript','languageFallback','eligibleForMatching']<>oldc-array['transcript','languageFallback','eligibleForMatching'] then return false; end if;
   if c#>>'{transcript,status}'='pending' and c#>'{transcript,jobId}'<>oldc#>'{transcript,jobId}' then return false; end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function private.finish_resource_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

revoke all on function private.resource_web_actor(),private.expire_resource_runs(uuid),private.resource_request_valid(jsonb),private.resource_result_valid(public.resource_runs,jsonb),
 private.begin_resource_run(jsonb),private.read_resource_run(uuid),private.cancel_resource_run(uuid),private.claim_resource_run(uuid,uuid,uuid,jsonb),private.finish_resource_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_resource_run(jsonb),private.read_resource_run(uuid),private.cancel_resource_run(uuid) to authenticated;
grant execute on function private.claim_resource_run(uuid,uuid,uuid,jsonb),private.finish_resource_run(uuid,uuid,uuid,jsonb) to service_role;
create function public.begin_resource_run(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.begin_resource_run(p_request)$$;
create function public.read_resource_run(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.read_resource_run(p_run_id)$$;
create function public.cancel_resource_run(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.cancel_resource_run(p_run_id)$$;
create function public.claim_resource_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.claim_resource_run(p_owner_id,p_run_id,p_lease_id,p_skill)$$;
create function public.finish_resource_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.finish_resource_run(p_owner_id,p_run_id,p_lease_id,p_result)$$;
revoke all on function public.begin_resource_run(jsonb),public.read_resource_run(uuid),public.cancel_resource_run(uuid),public.claim_resource_run(uuid,uuid,uuid,jsonb),public.finish_resource_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_resource_run(jsonb),public.read_resource_run(uuid),public.cancel_resource_run(uuid) to authenticated;
grant execute on function public.claim_resource_run(uuid,uuid,uuid,jsonb),public.finish_resource_run(uuid,uuid,uuid,jsonb) to service_role;

