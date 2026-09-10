-- Reviewed local CLI migra diff: omit unrelated pg_net DROP, retain explicit ACLs and dependency order.
-- Resource adoption verifies once, proposes once, and writes only on explicit confirmation.
create table public.resource_adoptions (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 source_run_id uuid not null references public.resource_runs(id) on delete cascade,
 blueprint_id uuid not null, blueprint_version integer not null check(blueprint_version>=0), node_id uuid not null,
 video_id text not null check(video_id~'^[A-Za-z0-9_-]{11}$'), replace_binding_id uuid, new_binding_id uuid not null unique,
 status text not null check(status in ('queued','running','ready','failed','cancelled','interrupted','stale','applied','rejected')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 verified_at timestamptz, valid_until timestamptz, result jsonb, proposal_id uuid unique,
 foreign key(blueprint_id,owner_id) references public.blueprints(id,owner_id) on delete cascade,
 foreign key(proposal_id,owner_id) references public.blueprint_proposals(id,owner_id) on delete cascade,
 check((status in ('queued','running'))=(result is null)),
 check((verified_at is null)=(valid_until is null)), check(proposal_id is null or verified_at is not null),
 check(status not in ('ready','applied','rejected') or proposal_id is not null)
);
create unique index resource_adoption_one_active on public.resource_adoptions(owner_id) where status in ('queued','running');
create index resource_adoption_owner_recent on public.resource_adoptions(owner_id,created_at desc,id desc);
create index resource_adoption_source on public.resource_adoptions(source_run_id);
create index resource_adoption_blueprint_owner on public.resource_adoptions(blueprint_id,owner_id);
create index resource_adoption_proposal_owner on public.resource_adoptions(proposal_id,owner_id);
alter table public.resource_adoptions enable row level security;
revoke all on public.resource_adoptions from public,anon,authenticated,service_role;
grant select on public.resource_adoptions to authenticated;
create policy resource_adoption_web_owner_read on public.resource_adoptions for select to authenticated
 using((select auth.uid())=owner_id and not(select private.is_extension_client()) and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);
create table private.resource_adoption_quotas (
 owner_id uuid primary key references auth.users(id) on delete cascade, available_attempts integer not null check(available_attempts>=0)
);
create table private.resource_adoption_leases (
 adoption_id uuid primary key references public.resource_adoptions(id) on delete cascade, lease_id uuid not null, completion_digest bytea
);
alter table private.resource_adoption_quotas enable row level security;
alter table private.resource_adoption_leases enable row level security;
revoke all on private.resource_adoption_quotas,private.resource_adoption_leases from public,anon,authenticated,service_role;
grant select,insert,update on private.resource_adoption_quotas to service_role;

create function private.resource_adoption_web_actor() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function private.resource_adoption_source_current(a public.resource_adoptions) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.resource_runs r join public.blueprints bp on bp.id=r.blueprint_id and bp.owner_id=r.owner_id
  where r.id=a.source_run_id and r.owner_id=a.owner_id and r.blueprint_id=a.blueprint_id and r.blueprint_version=a.blueprint_version
   and bp.version=a.blueprint_version and r.node_id=a.node_id and r.kind='match' and r.status='ready' and r.result->>'status'='matched'
   and exists(select 1 from jsonb_array_elements(r.result->'assessments') x where x->>'videoId'=a.video_id and x->>'role' in ('recommended','alternative'))
   and exists(select 1 from jsonb_array_elements(r.input_discovery->'candidates') c where c#>>'{video,videoId}'=a.video_id and c->'eligibleForMatching'='true'::jsonb and c#>>'{transcript,status}'='ready')
   and exists(select 1 from public.path_nodes n join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
    where n.id=a.node_id and n.owner_id=a.owner_id and n.node_type='learn' and n.archived_at is null and s.archived_at is null and g.archived_at is null and g.blueprint_id=a.blueprint_id))
$$;
-- Locks are always Blueprint, adoption, then quota/lease. No network work occurs here.
create function private.expire_resource_adoptions(p_owner_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare a public.resource_adoptions;
begin
 for a in select * from public.resource_adoptions where owner_id=p_owner_id and status in ('queued','running') and expires_at<=clock_timestamp() order by id for update loop
  update public.resource_adoptions set status=case when a.status='queued' then 'cancelled' else 'interrupted' end,
   result=jsonb_build_object('status',case when a.status='queued' then 'cancelled' else 'timed_out' end) where id=a.id;
  if a.status='queued' then update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id; end if;
 end loop;
 for a in select pending.* from public.resource_adoptions pending where pending.owner_id=p_owner_id and pending.status='queued'
  and not private.resource_adoption_source_current(pending) order by pending.id for update loop
  update public.resource_adoptions set status='stale',result='{"status":"invalid_input"}' where id=a.id;
  update private.resource_adoption_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id;
 end loop;
 update public.resource_adoptions ready set status='stale' where ready.owner_id=p_owner_id and ready.status='ready'
  and (ready.valid_until<=clock_timestamp() or not private.resource_adoption_source_current(ready));
end $$;

create function private.begin_resource_adoption(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function private.resource_adoption_operation(p_adoption_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.resource_adoption_web_actor(); a public.resource_adoptions; proposal public.blueprint_proposals;
begin
 if p_adoption_id is null or p_action not in ('read','cancel','reject') then raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.expire_resource_adoptions(actor);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=actor for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
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
end $$;
create function private.claim_resource_adoption(p_owner_id uuid,p_adoption_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_adoptions;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_adoption_id is null or p_lease_id is null then raise exception 'RESOURCE_ADOPTION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_adoptions(p_owner_id);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 if a.status<>'queued' then return jsonb_build_object('acquired',false,'adoption',to_jsonb(a)); end if;
 insert into private.resource_adoption_leases(adoption_id,lease_id) values(a.id,p_lease_id);
 update public.resource_adoptions set status='running',expires_at=clock_timestamp()+interval '120 seconds' where id=a.id returning * into a;
 return jsonb_build_object('acquired',true,'adoption',to_jsonb(a));
end $$;

create function private.resource_adoption_result_valid(v jsonb) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare video jsonb; field text;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>16384 or jsonb_typeof(v->'status') is distinct from 'string' then return false; end if;
 if v->>'status'<>'verified' then return v-array['status']='{}'::jsonb and v->>'status' in ('unavailable','not_found','not_available','changed','invalid_input','rate_limited','cancelled','timed_out'); end if;
 video:=v->'video';
 if v-array['status','video']<>'{}'::jsonb or jsonb_typeof(video) is distinct from 'object'
  or not(video ?& array['videoId','title','channelTitle','publishedAt','durationSeconds']) or video-array['videoId','title','channelTitle','publishedAt','durationSeconds']<>'{}'::jsonb
  or jsonb_typeof(video->'videoId') is distinct from 'string' or video->>'videoId'!~'^[A-Za-z0-9_-]{11}$'
  or jsonb_typeof(video->'durationSeconds') is distinct from 'number' or (video->>'durationSeconds')::numeric not between 1 and 86400 or mod((video->>'durationSeconds')::numeric,1)<>0
  or jsonb_typeof(video->'publishedAt') is distinct from 'string' or video->>'publishedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
 perform (video->>'publishedAt')::timestamptz;
 foreach field in array array['title','channelTitle'] loop
  if jsonb_typeof(video->field) is distinct from 'string' or length(btrim(video->>field))=0
   or length(video->>field)+length(regexp_replace(video->>field,U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 500 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

-- Rebuild from captured server source, never accept a caller's proposed Blueprint.
create function private.resource_adoption_draft(a public.resource_adoptions) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; target record; resources jsonb; binding jsonb; count_nodes integer:=0;
begin
 select input_blueprint into snapshot from public.resource_runs where id=a.source_run_id and owner_id=a.owner_id;
 if snapshot is null then return null; end if;
 binding:=jsonb_build_object('id',a.new_binding_id,'kind','youtube_video','url','https://www.youtube.com/watch?v='||a.video_id,'externalId',a.video_id);
 for target in select g.ordinality-1 gi,s.ordinality-1 si,n.ordinality-1 ni,n.value node
  from jsonb_array_elements(snapshot->'goals') with ordinality g(value,ordinality),
   jsonb_array_elements(g.value->'stages') with ordinality s(value,ordinality),jsonb_array_elements(s.value->'nodes') with ordinality n(value,ordinality)
  where n.value->>'id'=a.node_id::text and n.value->>'type'='learn' loop
  count_nodes:=count_nodes+1;
  resources:=target.node->'resources';
  if a.replace_binding_id is null then resources:=resources||jsonb_build_array(binding);
  else
   if not exists(select 1 from jsonb_array_elements(resources) r where r->>'id'=a.replace_binding_id::text) then return null; end if;
   select jsonb_agg(case when r.value->>'id'=a.replace_binding_id::text then binding else r.value end order by r.ordinality) into resources from jsonb_array_elements(resources) with ordinality r(value,ordinality);
  end if;
  if jsonb_array_length(resources)>16 then return null; end if;
  snapshot:=jsonb_set(snapshot,array['goals',target.gi::text,'stages',target.si::text,'nodes',target.ni::text,'resources'],resources);
 end loop;
 if count_nodes<>1 then return null; end if;
 return snapshot;
end $$;

create function private.finish_resource_adoption(p_owner_id uuid,p_adoption_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_adoptions; lease private.resource_adoption_leases; digest bytea; draft jsonb; proposal public.blueprint_proposals; verified timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_adoption_id is null or p_lease_id is null or not private.resource_adoption_result_valid(p_result) then raise exception 'RESOURCE_ADOPTION_INVALID_RESULT' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.expire_resource_adoptions(p_owner_id);
 select * into a from public.resource_adoptions where id=p_adoption_id and owner_id=p_owner_id for update;
 if not found then raise exception 'RESOURCE_ADOPTION_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.resource_adoption_leases where adoption_id=a.id for update;
 if not found or lease.lease_id<>p_lease_id then raise exception 'RESOURCE_ADOPTION_FORBIDDEN' using errcode='42501'; end if;
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
end $$;

create function private.is_resource_adoption_proposal(p_proposal_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.resource_adoptions where proposal_id=p_proposal_id and owner_id=auth.uid())
$$;
revoke all on function private.is_resource_adoption_proposal(uuid) from public,anon,authenticated,service_role;
grant execute on function private.is_resource_adoption_proposal(uuid) to authenticated;
create policy resource_adoption_proposal_immutable on public.blueprint_proposals as restrictive for update to authenticated
 using(not private.is_resource_adoption_proposal(id)) with check(not private.is_resource_adoption_proposal(id));
create policy resource_adoption_proposal_not_deleted on public.blueprint_proposals as restrictive for delete to authenticated using(not private.is_resource_adoption_proposal(id));

-- Retain the existing planning/manual guard intact, including historical idempotency receipts.
alter function private.apply_blueprint_proposal_guard(uuid,bigint,uuid) rename to apply_blueprint_proposal_pre_adoption;
alter function private.apply_blueprint_proposal_pre_adoption(uuid,bigint,uuid) security invoker;
revoke all on function private.apply_blueprint_proposal_pre_adoption(uuid,bigint,uuid) from public,anon,authenticated,service_role;
create function private.apply_blueprint_proposal_guard(proposal_id uuid,expected_version bigint,mutation_id uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a public.resource_adoptions; proposal public.blueprint_proposals; draft jsonb; applied bigint;
 target_proposal alias for proposal_id; target_version alias for expected_version; target_mutation alias for mutation_id;
begin
 if actor is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then raise exception 'BLUEPRINT_FORBIDDEN' using errcode='42501'; end if;
 if target_proposal is null or target_version is null or target_version<0 or target_mutation is null then raise exception 'PROPOSAL_ARGUMENTS_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=actor for update;
 select * into a from public.resource_adoptions where public.resource_adoptions.proposal_id=target_proposal and owner_id=actor for update;
 if not found then return private.apply_blueprint_proposal_pre_adoption(target_proposal,target_version,target_mutation); end if;
 select * into proposal from public.blueprint_proposals where id=target_proposal and owner_id=actor for update;
 if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
 if proposal.status='applied' then return private.apply_blueprint_proposal_pre_adoption(target_proposal,target_version,target_mutation); end if;
 if proposal.status<>'pending' or a.status='rejected' then raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514'; end if;
 if a.valid_until is null or a.valid_until<=clock_timestamp() then raise exception 'RESOURCE_ADOPTION_VERIFICATION_EXPIRED' using errcode='40001'; end if;
 if not private.resource_adoption_source_current(a) then raise exception 'RESOURCE_ADOPTION_SOURCE_CHANGED' using errcode='40001'; end if;
 draft:=private.resource_adoption_draft(a);
 if a.status<>'ready' or a.result->>'status' is distinct from 'verified' or proposal.blueprint_id<>a.blueprint_id or proposal.base_version<>a.blueprint_version
  or draft is null or proposal.proposed_snapshot is distinct from draft then raise exception 'RESOURCE_ADOPTION_PROPOSAL_INVALID' using errcode='23514'; end if;
 applied:=private.apply_blueprint_proposal_pre_adoption(target_proposal,target_version,target_mutation);
 -- The legacy writer stores each resource at position zero. Restore canonical
 -- array order here without changing its manual/planning behavior or duplicating it.
 update public.resource_bindings binding set position=(r.ordinality-1)::integer
  from jsonb_array_elements(draft->'goals') g, jsonb_array_elements(g->'stages') s, jsonb_array_elements(s->'nodes') n,
   jsonb_array_elements(n->'resources') with ordinality r(value,ordinality)
  where binding.id=(r.value->>'id')::uuid and binding.owner_id=actor and binding.archived_at is null;
 update public.resource_adoptions set status='applied' where id=a.id;
 return applied;
end $$;

revoke all on function private.resource_adoption_web_actor(),private.resource_adoption_source_current(public.resource_adoptions),private.expire_resource_adoptions(uuid),
 private.begin_resource_adoption(jsonb),private.resource_adoption_operation(uuid,text),private.claim_resource_adoption(uuid,uuid,uuid),private.resource_adoption_result_valid(jsonb),
 private.resource_adoption_draft(public.resource_adoptions),private.finish_resource_adoption(uuid,uuid,uuid,jsonb),private.apply_blueprint_proposal_guard(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.begin_resource_adoption(jsonb),private.resource_adoption_operation(uuid,text),private.apply_blueprint_proposal_guard(uuid,bigint,uuid) to authenticated;
grant execute on function private.claim_resource_adoption(uuid,uuid,uuid),private.finish_resource_adoption(uuid,uuid,uuid,jsonb) to service_role;
create function public.begin_resource_adoption(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.begin_resource_adoption(p_request)$$;
create function public.read_resource_adoption(p_adoption_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.resource_adoption_operation(p_adoption_id,'read')$$;
create function public.cancel_resource_adoption(p_adoption_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.resource_adoption_operation(p_adoption_id,'cancel')$$;
create function public.reject_resource_adoption(p_adoption_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.resource_adoption_operation(p_adoption_id,'reject')$$;
create function public.claim_resource_adoption(p_owner_id uuid,p_adoption_id uuid,p_lease_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.claim_resource_adoption(p_owner_id,p_adoption_id,p_lease_id)$$;
create function public.finish_resource_adoption(p_owner_id uuid,p_adoption_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.finish_resource_adoption(p_owner_id,p_adoption_id,p_lease_id,p_result)$$;
revoke all on function public.begin_resource_adoption(jsonb),public.read_resource_adoption(uuid),public.cancel_resource_adoption(uuid),public.reject_resource_adoption(uuid),
 public.claim_resource_adoption(uuid,uuid,uuid),public.finish_resource_adoption(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_resource_adoption(jsonb),public.read_resource_adoption(uuid),public.cancel_resource_adoption(uuid),public.reject_resource_adoption(uuid) to authenticated;
grant execute on function public.claim_resource_adoption(uuid,uuid,uuid),public.finish_resource_adoption(uuid,uuid,uuid,jsonb) to service_role;

