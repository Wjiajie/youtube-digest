-- The existing is_extension_client helper classifies ALL OAuth clients for Web-only
-- denial. Evidence additionally needs an exact allowlist, not that classification.
create function private.can_access_progress_evidence()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    (auth.jwt() ->> 'client_id') is null or exists (
      select 1 from private.app_config
      where key = 'extension_oauth_client_id' and value <> '' and value = (auth.jwt() ->> 'client_id')
    )
  )
$$;
revoke all on function private.can_access_progress_evidence() from public, anon, authenticated;
grant execute on function private.can_access_progress_evidence() to authenticated;

create table public.progress_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_mutation_id uuid not null,
  -- Historical context, not live joins: later path edits must not rewrite evidence.
  blueprint_id uuid not null,
  blueprint_version bigint not null check (blueprint_version >= 0),
  goal_id uuid not null,
  goal_title text not null,
  stage_id uuid not null,
  stage_title text not null,
  node_id uuid not null,
  node_title text not null,
  node_type public.path_node_type not null,
  evidence_text text not null check (char_length(btrim(evidence_text)) between 1 and 8000 and evidence_text ~ '[^[:space:]]'),
  artifact_url text check (artifact_url is null or (
    char_length(artifact_url) <= 2048 and artifact_url ~ '^https://[^/@[:space:]\\?#]+([/?#][^[:space:]\\]*)?$'
  )),
  created_at timestamptz not null default now(),
  unique (owner_id, client_mutation_id)
);
create index progress_evidence_owner_recent_idx on public.progress_evidence (owner_id, created_at desc, id desc);
alter table public.progress_evidence enable row level security;
revoke all on public.progress_evidence from public, anon, authenticated;
grant select on public.progress_evidence to authenticated;
create policy progress_evidence_owner_read on public.progress_evidence for select to authenticated
using ((select auth.uid()) = owner_id and (select private.can_access_progress_evidence()));

-- Only this narrow operation may write evidence; callers cannot forge historical context.
create or replace function private.record_progress_evidence(
  p_node_id uuid, p_expected_version bigint, p_evidence_text text, p_artifact_url text, p_client_mutation_id uuid
) returns public.progress_evidence
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  blueprint public.blueprints;
  context record;
  result public.progress_evidence;
begin
  if actor_id is null or not private.can_access_progress_evidence() then
    raise exception 'EVIDENCE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_node_id is null or p_client_mutation_id is null or p_expected_version is null or p_expected_version < 0
    or p_evidence_text is null or char_length(btrim(p_evidence_text)) not between 1 and 8000 or p_evidence_text !~ '[^[:space:]]'
    or (p_artifact_url is not null and (char_length(p_artifact_url) > 2048
      or p_artifact_url !~ '^https://[^/@[:space:]\\?#]+([/?#][^[:space:]\\]*)?$')) then
    raise exception 'EVIDENCE_INVALID' using errcode = '22023';
  end if;
  -- Same serialization point as proposal confirmation: capture one coherent path version.
  select * into blueprint from public.blueprints where owner_id = actor_id for update;
  if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into result from public.progress_evidence
  where owner_id = actor_id and client_mutation_id = p_client_mutation_id;
  if found then
    if result.node_id <> p_node_id or result.blueprint_version <> p_expected_version
      or result.evidence_text <> btrim(p_evidence_text) or result.artifact_url is distinct from p_artifact_url then
      raise exception 'EVIDENCE_MUTATION_REUSED' using errcode = '22023';
    end if;
    return result;
  end if;
  if blueprint.version <> p_expected_version then
    raise exception 'BLUEPRINT_VERSION_CONFLICT' using errcode = '40001';
  end if;
  select n.title as node_title, n.node_type, s.id as stage_id, s.title as stage_title, g.id as goal_id, g.title as goal_title
  into context
  from public.path_nodes n
  join public.stages s on s.id = n.stage_id and s.owner_id = n.owner_id
  join public.goals g on g.id = s.goal_id and g.owner_id = s.owner_id
  where n.id = p_node_id and n.owner_id = actor_id and g.blueprint_id = blueprint.id
    and n.archived_at is null and s.archived_at is null and g.archived_at is null;
  if not found then raise exception 'PATH_NODE_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.progress_evidence (
    owner_id, client_mutation_id, blueprint_id, blueprint_version, goal_id, goal_title,
    stage_id, stage_title, node_id, node_title, node_type, evidence_text, artifact_url
  ) values (
    actor_id, p_client_mutation_id, blueprint.id, blueprint.version, context.goal_id, context.goal_title,
    context.stage_id, context.stage_title, p_node_id, context.node_title, context.node_type, btrim(p_evidence_text), p_artifact_url
  ) returning * into result;
  return result;
end;
$$;
revoke all on function private.record_progress_evidence(uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function private.record_progress_evidence(uuid, bigint, text, text, uuid) to authenticated;

create function public.record_progress_evidence(
  p_node_id uuid, p_expected_version bigint, p_evidence_text text, p_artifact_url text, p_client_mutation_id uuid
) returns public.progress_evidence
language sql security invoker set search_path = ''
as $$
  select private.record_progress_evidence(p_node_id, p_expected_version, p_evidence_text, p_artifact_url, p_client_mutation_id)
$$;
revoke all on function public.record_progress_evidence(uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_progress_evidence(uuid, bigint, text, text, uuid) to authenticated;
