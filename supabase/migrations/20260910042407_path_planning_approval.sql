-- Reviewed local CLI diff: explicit ACLs and dependency order restored.
-- Move the existing v2 writer intact rather than duplicate its implementation.
create table private.path_planning_proposals (
  run_id uuid primary key references public.path_planning_runs(id) on delete cascade,
  proposal_id uuid not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  foreign key (proposal_id,owner_id) references public.blueprint_proposals(id,owner_id) on delete cascade
);
create index path_planning_proposals_owner_idx on private.path_planning_proposals(owner_id);
alter table private.path_planning_proposals enable row level security;
revoke all on private.path_planning_proposals from public,anon,authenticated,service_role;

create function private.is_path_planning_proposal(p_proposal_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.path_planning_proposals
    where proposal_id=p_proposal_id and owner_id=auth.uid())
$$;
revoke all on function private.is_path_planning_proposal(uuid) from public,anon,authenticated,service_role;
grant execute on function private.is_path_planning_proposal(uuid) to authenticated;
create policy proposals_linked_immutable on public.blueprint_proposals as restrictive for update to authenticated
  using (not private.is_path_planning_proposal(id)) with check (not private.is_path_planning_proposal(id));
create policy proposals_nonanonymous on public.blueprint_proposals as restrictive for all to authenticated
  using (((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb)
  with check (((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);

create function private.path_planning_source_current(p_run public.path_planning_runs) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.goal_briefs b join public.blueprints bp on bp.id=b.blueprint_id and bp.owner_id=b.owner_id
    where b.id=p_run.brief_id and b.owner_id=p_run.owner_id and b.blueprint_id=p_run.blueprint_id
      and b.status='confirmed' and b.revision=p_run.brief_revision and bp.version=p_run.blueprint_version)
$$;

-- Shared, Blueprint-locked operation. Never receives a client draft or creates formal paths.
create function private.path_planning_proposal_operation(p_run_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.path_planning_web_actor(); run public.path_planning_runs;
  proposal public.blueprint_proposals; proposal_json jsonb:='null'::jsonb; current_source boolean; applied_version bigint;
begin
  if p_run_id is null or p_action is null or p_action not in ('prepare','read','reject') then
    raise exception 'PATH_PLANNING_INVALID' using errcode='22023';
  end if;
  perform 1 from public.blueprints where owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  current_source:=private.path_planning_source_current(run);
  select p.* into proposal from private.path_planning_proposals link join public.blueprint_proposals p
    on p.id=link.proposal_id and p.owner_id=link.owner_id where link.run_id=run.id and link.owner_id=actor for update of p;
  if not found and p_action='prepare' then
    if not current_source then raise exception 'PATH_PLANNING_SOURCE_CHANGED' using errcode='40001'; end if;
    if run.status<>'ready' or run.result->>'status' is distinct from 'ready'
      or not private.path_planning_result_valid(run.result)
      or run.result#>>'{draft,id}' is distinct from run.blueprint_id::text
      or run.result#>'{draft,version}' is distinct from to_jsonb(run.blueprint_version) then
      raise exception 'PATH_PLANNING_NOT_READY' using errcode='22023';
    end if;
    insert into public.blueprint_proposals(owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
      values(actor,run.blueprint_id,run.blueprint_version,run.result->'draft',gen_random_uuid()) returning * into proposal;
    insert into private.path_planning_proposals(run_id,proposal_id,owner_id) values(run.id,proposal.id,actor);
  end if;
  if proposal.id is not null then
    if p_action='reject' then
      if proposal.status='applied' then raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514'; end if;
      if proposal.status='pending' then
        update public.blueprint_proposals set status='rejected',rejected_at=clock_timestamp()
          where id=proposal.id returning * into proposal;
      end if;
    end if;
    select version into applied_version from public.blueprint_revisions
      where proposal_id=proposal.id and owner_id=actor and blueprint_id=proposal.blueprint_id;
    proposal_json:=jsonb_build_object('id',proposal.id,'baseVersion',proposal.base_version,'status',proposal.status,
      'draft',proposal.proposed_snapshot,'appliedVersion',applied_version);
  end if;
  return jsonb_build_object('runId',run.id,'ownerId',actor,'sourceCurrent',current_source,'proposal',proposal_json);
end $$;

-- Preserve the complete latest v2 writer; no API role may call this core.
alter function public.apply_blueprint_proposal(uuid,bigint,uuid) set schema private;
alter function private.apply_blueprint_proposal(uuid,bigint,uuid) rename to apply_blueprint_proposal_core;
alter function private.apply_blueprint_proposal_core(uuid,bigint,uuid) security invoker;
revoke all on function private.apply_blueprint_proposal_core(uuid,bigint,uuid) from public,anon,authenticated,service_role;

create function private.apply_blueprint_proposal_guard(proposal_id uuid,expected_version bigint,mutation_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); proposal public.blueprint_proposals; run public.path_planning_runs;
  target_proposal alias for proposal_id; target_version alias for expected_version; target_mutation alias for mutation_id;
  applied_version bigint;
begin
  if actor is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then
    raise exception 'BLUEPRINT_FORBIDDEN' using errcode='42501';
  end if;
  if target_proposal is null or target_version is null or target_version<0 or target_mutation is null then
    raise exception 'PROPOSAL_ARGUMENTS_INVALID' using errcode='22023';
  end if;
  perform 1 from public.blueprints where owner_id=actor for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
  select * into proposal from public.blueprint_proposals where id=target_proposal and owner_id=actor for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND' using errcode='P0002'; end if;
  if proposal.status='applied' then
    if proposal.applied_mutation_id is distinct from target_mutation then
      raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514';
    end if;
    if proposal.base_version<>target_version then raise exception 'BLUEPRINT_VERSION_CONFLICT' using errcode='40001'; end if;
    select r.version into applied_version from public.blueprint_revisions r
      where r.proposal_id=proposal.id and r.owner_id=actor and r.blueprint_id=proposal.blueprint_id;
    if applied_version is null then raise exception 'PROPOSAL_CONFIRMATION_MISSING' using errcode='23514'; end if;
    return applied_version;
  end if;
  if proposal.status<>'pending' then raise exception 'PROPOSAL_NOT_PENDING' using errcode='23514'; end if;
  select r.* into run from private.path_planning_proposals link join public.path_planning_runs r
    on r.id=link.run_id and r.owner_id=link.owner_id where link.proposal_id=proposal.id and link.owner_id=actor for update of r;
  if found then
    if not private.path_planning_source_current(run) then raise exception 'PATH_PLANNING_SOURCE_CHANGED' using errcode='40001'; end if;
    if run.status<>'ready' or run.result->>'status' is distinct from 'ready'
      or proposal.blueprint_id<>run.blueprint_id or proposal.base_version<>run.blueprint_version
      or proposal.proposed_snapshot is distinct from run.result->'draft' then
      raise exception 'PATH_PLANNING_PROPOSAL_INVALID' using errcode='23514';
    end if;
  end if;
  return private.apply_blueprint_proposal_core(target_proposal,target_version,target_mutation);
end $$;

create function public.prepare_path_planning_proposal(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.path_planning_proposal_operation(p_run_id,'prepare') $$;
create function public.read_path_planning_proposal(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.path_planning_proposal_operation(p_run_id,'read') $$;
create function public.reject_path_planning_proposal(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.path_planning_proposal_operation(p_run_id,'reject') $$;
create function public.apply_blueprint_proposal(proposal_id uuid,expected_version bigint,mutation_id uuid) returns bigint language sql security invoker set search_path='' as $$ select private.apply_blueprint_proposal_guard(proposal_id,expected_version,mutation_id) $$;
revoke all on function private.path_planning_source_current(public.path_planning_runs),private.path_planning_proposal_operation(uuid,text),private.apply_blueprint_proposal_guard(uuid,bigint,uuid),
  public.prepare_path_planning_proposal(uuid),public.read_path_planning_proposal(uuid),public.reject_path_planning_proposal(uuid),public.apply_blueprint_proposal(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.path_planning_proposal_operation(uuid,text),private.apply_blueprint_proposal_guard(uuid,bigint,uuid),
  public.prepare_path_planning_proposal(uuid),public.read_path_planning_proposal(uuid),public.reject_path_planning_proposal(uuid),public.apply_blueprint_proposal(uuid,bigint,uuid) to authenticated;
