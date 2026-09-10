-- Reviewed Supabase CLI local diff: dependency order and explicit function ACLs restored.
-- Durable runs store captured inputs/results only; formal Blueprint writes remain separate.
create table public.path_planning_runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  brief_id uuid not null,
  blueprint_id uuid not null,
  brief_revision integer not null check (brief_revision > 0),
  blueprint_version integer not null check (blueprint_version >= 0),
  start_date date not null,
  status text not null check (status in ('queued','running','ready','failed','cancelled','interrupted','stale')),
  input_brief jsonb not null check (jsonb_typeof(input_brief) = 'object'),
  input_blueprint jsonb not null check (jsonb_typeof(input_blueprint) = 'object'),
  skill jsonb,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (blueprint_id, owner_id) references public.blueprints(id, owner_id) on delete cascade,
  check ((status in ('queued','running')) = (result is null)),
  check (status <> 'queued' or skill is null),
  check (status <> 'running' or skill is not null)
);
create unique index path_planning_one_active_owner on public.path_planning_runs(owner_id) where status in ('queued','running');
create index path_planning_owner_recent on public.path_planning_runs(owner_id,created_at desc,id desc);
create index path_planning_blueprint_owner on public.path_planning_runs(blueprint_id,owner_id);
alter table public.path_planning_runs enable row level security;
revoke all on public.path_planning_runs from public,anon,authenticated;
grant select on public.path_planning_runs to authenticated;
create policy path_planning_web_owner_read on public.path_planning_runs for select to authenticated
  using ((select auth.uid()) = owner_id and not (select private.is_extension_client())
    and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);

create table private.path_planning_quotas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  available_attempts integer not null check (available_attempts >= 0)
);
create table private.path_planning_leases (
  run_id uuid primary key references public.path_planning_runs(id) on delete cascade,
  lease_id uuid not null,
  completion_digest bytea
);
alter table private.path_planning_quotas enable row level security;
alter table private.path_planning_leases enable row level security;
revoke all on private.path_planning_quotas,private.path_planning_leases from public,anon,authenticated;
revoke all on private.path_planning_quotas from service_role;
grant select,insert,update on private.path_planning_quotas to service_role;
grant usage on schema private to service_role;

create function private.path_planning_web_actor() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous' = 'true'::jsonb then
    raise exception 'PATH_PLANNING_FORBIDDEN' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Called only after taking the owner's Blueprint lock. No provider is invoked.
create function private.expire_path_planning(p_owner_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare expired public.path_planning_runs;
begin
  for expired in select * from public.path_planning_runs where owner_id=p_owner_id
    and status in ('queued','running') and expires_at <= clock_timestamp() for update loop
    update public.path_planning_runs set
      status=case when expired.status='queued' then 'cancelled' else 'interrupted' end,
      result=jsonb_build_object('status',case when expired.status='queued' then 'cancelled' else 'timed_out' end,
        'providerMayHaveRun',expired.status='running','usage',null)
      where id=expired.id;
    if expired.status='queued' then
      update private.path_planning_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id;
    end if;
  end loop;
  -- Source edits before execution invalidate only an unclaimed reservation.
  for expired in select r.* from public.path_planning_runs r
    where r.owner_id=p_owner_id and r.status='queued' and not exists(
      select 1 from public.goal_briefs brief join public.blueprints bp on bp.id=brief.blueprint_id and bp.owner_id=brief.owner_id
      where brief.id=r.brief_id and brief.owner_id=r.owner_id and brief.blueprint_id=r.blueprint_id
        and brief.status='confirmed' and brief.revision=r.brief_revision and bp.version=r.blueprint_version) for update loop
    update public.path_planning_runs set status='failed',
      result=jsonb_build_object('status','invalid_input','providerMayHaveRun',false,'usage',null) where id=expired.id;
    update private.path_planning_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id;
  end loop;
  -- A recovered completed draft must not masquerade as current after source edits.
  update public.path_planning_runs r set status='stale'
    where r.owner_id=p_owner_id and r.status='ready' and not exists(
      select 1 from public.goal_briefs brief join public.blueprints bp on bp.id=brief.blueprint_id and bp.owner_id=brief.owner_id
      where brief.id=r.brief_id and brief.owner_id=r.owner_id and brief.blueprint_id=r.blueprint_id
        and brief.status='confirmed' and brief.revision=r.brief_revision and bp.version=r.blueprint_version);
end $$;

create function private.begin_path_planning(p_run_id uuid,p_brief_id uuid,p_expected_brief_revision integer,p_expected_blueprint_version integer,p_start_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.path_planning_web_actor(); bp public.blueprints; brief public.goal_briefs;
  run public.path_planning_runs; snapshot jsonb; today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_run_id is null or p_brief_id is null or p_expected_brief_revision is null or p_expected_brief_revision<1
    or p_expected_blueprint_version is null or p_expected_blueprint_version<0 or p_start_date is null then
    raise exception 'PATH_PLANNING_INVALID' using errcode='22023';
  end if;
  select * into bp from public.blueprints where owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.expire_path_planning(actor);
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=actor for update;
  if found then
    if run.owner_id<>actor then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
    if run.brief_id<>p_brief_id or run.brief_revision<>p_expected_brief_revision
      or run.blueprint_version<>p_expected_blueprint_version or run.start_date<>p_start_date then
      raise exception 'PATH_PLANNING_RUN_REUSED' using errcode='22023';
    end if;
    return to_jsonb(run);
  end if;
  if exists(select 1 from public.path_planning_runs where id=p_run_id) then
    raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002';
  end if;
  select * into brief from public.goal_briefs where id=p_brief_id and owner_id=actor and blueprint_id=bp.id;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  if brief.revision<>p_expected_brief_revision or bp.version<>p_expected_blueprint_version then
    raise exception 'PATH_PLANNING_VERSION_CONFLICT' using errcode='40001';
  end if;
  if brief.status<>'confirmed' or p_start_date < today-1 or p_start_date > today+1
    or (brief.content->>'targetDate')::date < p_start_date then
    raise exception 'PATH_PLANNING_INVALID' using errcode='22023';
  end if;
  snapshot := public.read_blueprint_snapshot_v2(actor);
  if snapshot is null or jsonb_array_length(snapshot->'goals')>=12 then
    raise exception 'PATH_PLANNING_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from public.path_planning_runs where owner_id=actor and status in ('queued','running')) then
    raise exception 'PATH_PLANNING_BUSY' using errcode='P0001';
  end if;
  update private.path_planning_quotas set available_attempts=available_attempts-1 where owner_id=actor and available_attempts>0;
  if not found then raise exception 'PATH_PLANNING_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
  insert into public.path_planning_runs(id,owner_id,brief_id,blueprint_id,brief_revision,blueprint_version,start_date,status,input_brief,input_blueprint,expires_at)
  values(p_run_id,actor,brief.id,bp.id,brief.revision,bp.version,p_start_date,'queued',
    jsonb_build_object('id',brief.id,'blueprintId',brief.blueprint_id,'revision',brief.revision,'status',brief.status,
      'content',brief.content,'updatedAt',brief.updated_at),snapshot,clock_timestamp()+interval '120 seconds') returning * into run;
  return to_jsonb(run);
exception when unique_violation then
  raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002';
end $$;

create function private.read_path_planning(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.path_planning_web_actor(); run public.path_planning_runs;
begin
  perform 1 from public.blueprints where owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.expire_path_planning(actor);
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=actor;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  return to_jsonb(run);
end $$;

create function private.cancel_path_planning(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.path_planning_web_actor(); run public.path_planning_runs;
begin
  perform 1 from public.blueprints where owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.expire_path_planning(actor);
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=actor for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  if run.status in ('queued','running') then
    if run.status='queued' then
      update private.path_planning_quotas set available_attempts=available_attempts+1 where owner_id=actor;
    end if;
    update public.path_planning_runs set status='cancelled',
      result=jsonb_build_object('status','cancelled','providerMayHaveRun',run.status='running','usage',null)
      where id=run.id returning * into run;
  end if;
  return to_jsonb(run);
end $$;

create function private.claim_path_planning(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.path_planning_runs;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'PATH_PLANNING_FORBIDDEN' using errcode='42501'; end if;
  if p_owner_id is null or p_run_id is null or p_lease_id is null
    or jsonb_typeof(p_skill) is distinct from 'object' or not (p_skill ?& array['name','version','sha256','instructions'])
    or p_skill - array['name','version','sha256','instructions'] <> '{}'::jsonb
    or jsonb_typeof(p_skill->'name') is distinct from 'string' or p_skill->>'name'<>'blueprint-plan-path'
    or jsonb_typeof(p_skill->'version') is distinct from 'string' or length(p_skill->>'version')>64
    or p_skill->>'version'!~'^[0-9]+\.[0-9]+\.[0-9]+$'
    or jsonb_typeof(p_skill->'sha256') is distinct from 'string' or p_skill->>'sha256'!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_skill->'instructions') is distinct from 'string'
    -- PostgreSQL counts code points; supplementary characters add one UTF-16 unit.
    or length(p_skill->>'instructions')+length(regexp_replace(p_skill->>'instructions',U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 32000
    or encode(sha256(convert_to(p_skill->>'instructions','UTF8')),'hex')<>p_skill->>'sha256' then
    raise exception 'PATH_PLANNING_INVALID_SKILL' using errcode='22023';
  end if;
  perform 1 from public.blueprints where owner_id=p_owner_id for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.expire_path_planning(p_owner_id);
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  if run.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(run)); end if;
  insert into private.path_planning_leases(run_id,lease_id) values(run.id,p_lease_id);
  update public.path_planning_runs set status='running',skill=p_skill,expires_at=clock_timestamp()+interval '120 seconds'
    where id=run.id returning * into run;
  return jsonb_build_object('acquired',true,'run',to_jsonb(run));
end $$;

create function private.path_planning_result_valid(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare field text; usage jsonb;
begin
  if value is null or jsonb_typeof(value)<>'object'
    or not(value ?& array['status','providerMayHaveRun','usage'])
    or jsonb_typeof(value->'status') is distinct from 'string'
    or jsonb_typeof(value->'providerMayHaveRun') is distinct from 'boolean' then return false; end if;
  usage:=value->'usage';
  if usage<>'null'::jsonb then
    if jsonb_typeof(usage)<>'object' or not(usage ?& array['inputTokens','outputTokens','totalTokens'])
      or usage-array['inputTokens','outputTokens','totalTokens']<>'{}'::jsonb then return false; end if;
    foreach field in array array['inputTokens','outputTokens','totalTokens'] loop
      if usage->field<>'null'::jsonb and (jsonb_typeof(usage->field)<>'number'
        or (usage->>field)::numeric<0 or (usage->>field)::numeric>9007199254740991
        or mod((usage->>field)::numeric,1)<>0) then return false; end if;
    end loop;
  end if;
  if value->>'status'='ready' then
    return coalesce(value - array['status','providerMayHaveRun','usage','draft','schedule','assumptions','skill','source']='{}'::jsonb
      and value ?& array['draft','schedule','assumptions','skill','source']
      and value->'providerMayHaveRun'='true'::jsonb and usage<>'null'::jsonb
      and jsonb_typeof(value->'draft')='object' and value#>'{draft,schemaVersion}'='2'::jsonb
      and jsonb_typeof(value#>'{draft,goals}')='array'
      and jsonb_array_length(value#>'{draft,goals}') between 1 and 12
      and jsonb_typeof(value->'schedule')='array' and jsonb_array_length(value->'schedule') between 1 and 128
      and jsonb_typeof(value->'assumptions')='array'
      and not exists(select 1 from jsonb_array_elements(value->'assumptions') a where jsonb_typeof(a)<>'string')
      and jsonb_typeof(value->'skill')='object' and jsonb_typeof(value->'source')='object',false);
  end if;
  return value->>'status' in ('invalid_input','needs_confirmation','unavailable','invalid_output','cancelled','timed_out')
    and value-array['status','providerMayHaveRun','usage']='{}'::jsonb;
exception when others then return false;
end $$;

create function private.finish_path_planning(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare run public.path_planning_runs; lease private.path_planning_leases; bp public.blueprints;
  brief public.goal_briefs; fingerprint bytea; next_status text; stored_result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'PATH_PLANNING_FORBIDDEN' using errcode='42501'; end if;
  if p_owner_id is null or p_run_id is null or p_lease_id is null
    or not private.path_planning_result_valid(p_result) then raise exception 'PATH_PLANNING_INVALID_RESULT' using errcode='22023'; end if;
  select * into bp from public.blueprints where owner_id=p_owner_id for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.expire_path_planning(p_owner_id);
  select * into run from public.path_planning_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not found then raise exception 'PATH_PLANNING_NOT_FOUND' using errcode='P0002'; end if;
  select * into lease from private.path_planning_leases where run_id=run.id for update;
  if not found or lease.lease_id<>p_lease_id then raise exception 'PATH_PLANNING_FORBIDDEN' using errcode='42501'; end if;
  fingerprint:=sha256(convert_to(p_result::text,'UTF8'));
  if lease.completion_digest is not null then
    if lease.completion_digest<>fingerprint then raise exception 'PATH_PLANNING_COMPLETION_REUSED' using errcode='22023'; end if;
    return to_jsonb(run);
  end if;
  if p_result->>'status'='ready' and (
    p_result->'source'<>jsonb_build_object('runId',run.id,'briefId',run.brief_id,'briefRevision',run.brief_revision,
      'blueprintId',run.blueprint_id,'blueprintVersion',run.blueprint_version,'startDate',run.start_date)
    or p_result->'skill'<>run.skill
    or p_result#>>'{draft,id}' is distinct from run.blueprint_id::text
    or p_result#>'{draft,version}' is distinct from to_jsonb(run.blueprint_version)
    ) then raise exception 'PATH_PLANNING_INVALID_RESULT' using errcode='22023'; end if;
  if run.status in ('cancelled','interrupted') then
    stored_result:=jsonb_build_object('status',case when run.status='cancelled' then 'cancelled' else 'timed_out' end,
      'providerMayHaveRun',true,'usage',p_result->'usage');
    next_status:=run.status;
  elsif run.status='running' then
    stored_result:=p_result;
    next_status:=case when p_result->>'status'='ready' then 'ready' when p_result->>'status'='cancelled' then 'cancelled' else 'failed' end;
    if next_status='ready' then
      select * into brief from public.goal_briefs where id=run.brief_id and owner_id=p_owner_id and blueprint_id=run.blueprint_id;
      if not found or brief.revision<>run.brief_revision or brief.status<>'confirmed' or bp.version<>run.blueprint_version then next_status:='stale'; end if;
    end if;
  else raise exception 'PATH_PLANNING_INVALID_STATE' using errcode='22023'; end if;
  update private.path_planning_leases set completion_digest=fingerprint where run_id=run.id;
  update public.path_planning_runs set status=next_status,result=stored_result where id=run.id returning * into run;
  return to_jsonb(run);
end $$;

revoke all on function private.path_planning_web_actor(),private.expire_path_planning(uuid),
  private.path_planning_result_valid(jsonb),private.begin_path_planning(uuid,uuid,integer,integer,date),
  private.read_path_planning(uuid),private.cancel_path_planning(uuid),
  private.claim_path_planning(uuid,uuid,uuid,jsonb),private.finish_path_planning(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_path_planning(uuid,uuid,integer,integer,date),private.read_path_planning(uuid),private.cancel_path_planning(uuid) to authenticated;
grant execute on function private.claim_path_planning(uuid,uuid,uuid,jsonb),private.finish_path_planning(uuid,uuid,uuid,jsonb) to service_role;

create function public.begin_path_planning(p_run_id uuid,p_brief_id uuid,p_expected_brief_revision integer,p_expected_blueprint_version integer,p_start_date date)
returns jsonb language sql security invoker set search_path = '' as $$ select private.begin_path_planning(p_run_id,p_brief_id,p_expected_brief_revision,p_expected_blueprint_version,p_start_date) $$;
create function public.read_path_planning(p_run_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.read_path_planning(p_run_id) $$;
create function public.cancel_path_planning(p_run_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.cancel_path_planning(p_run_id) $$;
create function public.claim_path_planning(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.claim_path_planning(p_owner_id,p_run_id,p_lease_id,p_skill) $$;
create function public.finish_path_planning(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.finish_path_planning(p_owner_id,p_run_id,p_lease_id,p_result) $$;
revoke all on function public.begin_path_planning(uuid,uuid,integer,integer,date),public.read_path_planning(uuid),public.cancel_path_planning(uuid),
  public.claim_path_planning(uuid,uuid,uuid,jsonb),public.finish_path_planning(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_path_planning(uuid,uuid,integer,integer,date),public.read_path_planning(uuid),public.cancel_path_planning(uuid) to authenticated;
grant execute on function public.claim_path_planning(uuid,uuid,uuid,jsonb),public.finish_path_planning(uuid,uuid,uuid,jsonb) to service_role;
