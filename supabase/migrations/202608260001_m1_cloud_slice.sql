create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.path_node_type as enum (
  'learn',
  'practice',
  'checkpoint',
  'reflection'
);
create type public.resource_kind as enum ('youtube_video');
create type public.proposal_status as enum ('pending', 'applied', 'rejected');
create type public.learning_session_status as enum ('active', 'ended');
create type public.product_surface as enum ('web', 'extension', 'server');
create type public.product_event_name as enum (
  'auth_requested',
  'auth_succeeded',
  'auth_failed',
  'extension_authorized',
  'extension_denied',
  'extension_revoked',
  'blueprint_viewed',
  'proposal_created',
  'proposal_applied',
  'proposal_rejected',
  'proposal_conflict',
  'learning_session_started',
  'sync_failed',
  'sync_recovered'
);

create table private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table private.invite_allowlist (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  status text not null default 'active' check (status in ('active', 'used', 'revoked')),
  expires_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_email_invited(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.invite_allowlist
    where email = candidate_email::extensions.citext
      and (
        status = 'used'
        or (status = 'active' and (expires_at is null or expires_at > now()))
      )
  )
$$;

revoke all on function public.is_email_invited(text) from public, anon, authenticated;
grant execute on function public.is_email_invited(text) to service_role;

create or replace function public.consume_email_invite(candidate_email text, user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.invite_allowlist
  set status = 'used', used_by = user_id, used_at = now()
  where email = candidate_email::extensions.citext and status = 'active'
$$;

revoke all on function public.consume_email_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_email_invite(text, uuid) to service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blueprints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  title text not null default '我的蓝图' check (char_length(title) between 1 and 240),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.goals (
  id uuid primary key,
  owner_id uuid not null,
  blueprint_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  description text check (description is null or char_length(description) <= 2000),
  position integer not null check (position >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (blueprint_id, owner_id) references public.blueprints(id, owner_id) on delete cascade
);

create table public.stages (
  id uuid primary key,
  owner_id uuid not null,
  goal_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  position integer not null check (position >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (goal_id, owner_id) references public.goals(id, owner_id) on delete cascade
);

create table public.path_nodes (
  id uuid primary key,
  owner_id uuid not null,
  stage_id uuid not null,
  node_type public.path_node_type not null,
  title text not null check (char_length(title) between 1 and 240),
  description text check (description is null or char_length(description) <= 2000),
  position integer not null check (position >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (stage_id, owner_id) references public.stages(id, owner_id) on delete cascade
);

create table public.path_node_dependencies (
  owner_id uuid not null,
  node_id uuid not null,
  dependency_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (node_id, dependency_id),
  check (node_id <> dependency_id),
  foreign key (node_id, owner_id) references public.path_nodes(id, owner_id) on delete cascade deferrable initially deferred,
  foreign key (dependency_id, owner_id) references public.path_nodes(id, owner_id) on delete cascade deferrable initially deferred
);

create table public.resource_bindings (
  id uuid primary key,
  owner_id uuid not null,
  node_id uuid not null,
  kind public.resource_kind not null,
  url text not null check (
    url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'
  ),
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint resource_bindings_url_external_id_match check (
    url = 'https://www.youtube.com/watch?v=' || external_id
  ),
  position integer not null default 0 check (position >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, owner_id, node_id),
  foreign key (node_id, owner_id) references public.path_nodes(id, owner_id) on delete cascade
);

create table public.blueprint_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  blueprint_id uuid not null,
  base_version bigint not null check (base_version >= 0),
  proposed_snapshot jsonb not null,
  proposed_diff jsonb not null default '[]'::jsonb,
  status public.proposal_status not null default 'pending',
  client_mutation_id uuid not null,
  applied_mutation_id uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rejected_at timestamptz,
  unique (owner_id, client_mutation_id),
  unique (id, owner_id),
  foreign key (blueprint_id, owner_id) references public.blueprints(id, owner_id) on delete cascade
);

create table public.blueprint_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  blueprint_id uuid not null,
  proposal_id uuid not null,
  version bigint not null check (version > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (blueprint_id, version),
  foreign key (blueprint_id, owner_id) references public.blueprints(id, owner_id) on delete cascade,
  foreign key (proposal_id, owner_id) references public.blueprint_proposals(id, owner_id) on delete restrict
);

create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null,
  resource_binding_id uuid,
  status public.learning_session_status not null default 'active',
  source public.product_surface not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, client_mutation_id),
  foreign key (node_id, owner_id) references public.path_nodes(id, owner_id) on delete restrict,
  foreign key (resource_binding_id, owner_id, node_id)
    references public.resource_bindings(id, owner_id, node_id) on delete restrict
);

create table public.product_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name public.product_event_name not null,
  surface public.product_surface not null,
  entity_type text,
  entity_id uuid,
  result_code text check (result_code is null or char_length(result_code) <= 64),
  duration_bucket text check (duration_bucket is null or duration_bucket in ('lt_100ms', 'lt_1s', 'lt_5s', 'gte_5s')),
  occurred_at timestamptz not null default now()
);

create index goals_blueprint_active_idx on public.goals (blueprint_id, position) where archived_at is null;
create index stages_goal_active_idx on public.stages (goal_id, position) where archived_at is null;
create index path_nodes_stage_active_idx on public.path_nodes (stage_id, position) where archived_at is null;
create index resource_bindings_node_active_idx on public.resource_bindings (node_id, position) where archived_at is null;
create unique index resource_bindings_active_external_idx
  on public.resource_bindings (node_id, kind, external_id) where archived_at is null;
create index learning_sessions_owner_started_idx on public.learning_sessions (owner_id, started_at desc);
create index product_events_owner_occurred_idx on public.product_events (owner_id, occurred_at desc);
create index invite_allowlist_used_by_idx on private.invite_allowlist (used_by);
create index goals_blueprint_owner_idx on public.goals (blueprint_id, owner_id);
create index stages_goal_owner_idx on public.stages (goal_id, owner_id);
create index path_nodes_stage_owner_idx on public.path_nodes (stage_id, owner_id);
create index path_node_dependencies_node_owner_idx on public.path_node_dependencies (node_id, owner_id);
create index path_node_dependencies_dependency_owner_idx on public.path_node_dependencies (dependency_id, owner_id);
create index resource_bindings_node_owner_idx on public.resource_bindings (node_id, owner_id);
create index blueprint_proposals_blueprint_owner_idx on public.blueprint_proposals (blueprint_id, owner_id);
create index blueprint_revisions_blueprint_owner_idx on public.blueprint_revisions (blueprint_id, owner_id);
create index blueprint_revisions_proposal_owner_idx on public.blueprint_revisions (proposal_id, owner_id);
create index learning_sessions_node_owner_idx on public.learning_sessions (node_id, owner_id);
create index learning_sessions_resource_owner_node_idx
  on public.learning_sessions (resource_binding_id, owner_id, node_id);

create or replace function private.is_extension_client()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() ->> 'client_id') = (
      select value from private.app_config where key = 'extension_oauth_client_id'
    ),
    false
  )
$$;

revoke all on function private.is_extension_client() from public;
grant execute on function private.is_extension_client() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.blueprints (owner_id) values (new.id) on conflict (owner_id) do nothing;
  update private.invite_allowlist
  set status = 'used', used_by = new.id, used_at = now()
  where email = new.email::extensions.citext and status = 'active';
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.apply_blueprint_proposal(
  proposal_id uuid,
  expected_version bigint,
  mutation_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_proposal_id alias for proposal_id;
  target_expected_version alias for expected_version;
  target_mutation_id alias for mutation_id;
  current_user_id uuid := auth.uid();
  proposal public.blueprint_proposals%rowtype;
  current_version bigint;
  next_version bigint;
  snapshot jsonb;
  goal_json jsonb;
  stage_json jsonb;
  node_json jsonb;
  resource_json jsonb;
  dependency_json jsonb;
  invalid_dependency boolean;
begin
  if current_user_id is null or private.is_extension_client() then
    raise exception using errcode = '42501', message = 'BLUEPRINT_FORBIDDEN';
  end if;

  select * into proposal
  from public.blueprint_proposals
  where id = target_proposal_id and owner_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROPOSAL_NOT_FOUND';
  end if;

  if proposal.status = 'applied' and proposal.applied_mutation_id = target_mutation_id then
    select version into current_version from public.blueprints where id = proposal.blueprint_id;
    return current_version;
  end if;
  if proposal.status <> 'pending' then
    raise exception using errcode = '23514', message = 'PROPOSAL_NOT_PENDING';
  end if;

  select version into current_version
  from public.blueprints
  where id = proposal.blueprint_id and owner_id = current_user_id
  for update;

  if current_version <> target_expected_version or current_version <> proposal.base_version then
    raise exception using errcode = '40001', message = 'BLUEPRINT_VERSION_CONFLICT';
  end if;

  snapshot := proposal.proposed_snapshot;
  if snapshot ->> 'id' <> proposal.blueprint_id::text then
    raise exception using errcode = '23514', message = 'BLUEPRINT_ID_MISMATCH';
  end if;

  update public.resource_bindings resource
  set archived_at = now(), updated_at = now()
  from public.path_nodes node
  join public.stages stage on stage.id = node.stage_id and stage.owner_id = node.owner_id
  join public.goals goal on goal.id = stage.goal_id and goal.owner_id = stage.owner_id
  where resource.node_id = node.id
    and resource.owner_id = current_user_id
    and goal.blueprint_id = proposal.blueprint_id;

  delete from public.path_node_dependencies dependency
  using public.path_nodes node, public.stages stage, public.goals goal
  where dependency.node_id = node.id
    and dependency.owner_id = current_user_id
    and stage.id = node.stage_id and stage.owner_id = node.owner_id
    and goal.id = stage.goal_id and goal.owner_id = stage.owner_id
    and goal.blueprint_id = proposal.blueprint_id;

  update public.path_nodes node
  set archived_at = now(), updated_at = now()
  from public.stages stage, public.goals goal
  where node.stage_id = stage.id and node.owner_id = current_user_id
    and goal.id = stage.goal_id and goal.owner_id = stage.owner_id
    and goal.blueprint_id = proposal.blueprint_id;

  update public.stages stage
  set archived_at = now(), updated_at = now()
  from public.goals goal
  where stage.goal_id = goal.id and stage.owner_id = current_user_id
    and goal.blueprint_id = proposal.blueprint_id;

  update public.goals set archived_at = now(), updated_at = now()
  where blueprint_id = proposal.blueprint_id and owner_id = current_user_id;

  for goal_json in select value from jsonb_array_elements(coalesce(snapshot -> 'goals', '[]'::jsonb)) loop
    insert into public.goals (id, owner_id, blueprint_id, title, description, position, archived_at)
    values (
      (goal_json ->> 'id')::uuid,
      current_user_id,
      proposal.blueprint_id,
      goal_json ->> 'title',
      goal_json ->> 'description',
      (goal_json ->> 'position')::integer,
      null
    )
    on conflict (id) do update set
      blueprint_id = excluded.blueprint_id,
      title = excluded.title,
      description = excluded.description,
      position = excluded.position,
      archived_at = null,
      updated_at = now()
    where public.goals.owner_id = current_user_id;

    for stage_json in select value from jsonb_array_elements(coalesce(goal_json -> 'stages', '[]'::jsonb)) loop
      insert into public.stages (id, owner_id, goal_id, title, position, archived_at)
      values (
        (stage_json ->> 'id')::uuid,
        current_user_id,
        (goal_json ->> 'id')::uuid,
        stage_json ->> 'title',
        (stage_json ->> 'position')::integer,
        null
      )
      on conflict (id) do update set
        goal_id = excluded.goal_id,
        title = excluded.title,
        position = excluded.position,
        archived_at = null,
        updated_at = now()
      where public.stages.owner_id = current_user_id;

      for node_json in select value from jsonb_array_elements(coalesce(stage_json -> 'nodes', '[]'::jsonb)) loop
        insert into public.path_nodes (id, owner_id, stage_id, node_type, title, description, position, archived_at)
        values (
          (node_json ->> 'id')::uuid,
          current_user_id,
          (stage_json ->> 'id')::uuid,
          (node_json ->> 'type')::public.path_node_type,
          node_json ->> 'title',
          node_json ->> 'description',
          (node_json ->> 'position')::integer,
          null
        )
        on conflict (id) do update set
          stage_id = excluded.stage_id,
          node_type = excluded.node_type,
          title = excluded.title,
          description = excluded.description,
          position = excluded.position,
          archived_at = null,
          updated_at = now()
        where public.path_nodes.owner_id = current_user_id;

        for dependency_json in select value from jsonb_array_elements(coalesce(node_json -> 'dependencyIds', '[]'::jsonb)) loop
          insert into public.path_node_dependencies (owner_id, node_id, dependency_id)
          values (current_user_id, (node_json ->> 'id')::uuid, (dependency_json #>> '{}')::uuid);
        end loop;

        for resource_json in select value from jsonb_array_elements(coalesce(node_json -> 'resources', '[]'::jsonb)) loop
          insert into public.resource_bindings (id, owner_id, node_id, kind, url, external_id, position, archived_at)
          values (
            (resource_json ->> 'id')::uuid,
            current_user_id,
            (node_json ->> 'id')::uuid,
            (resource_json ->> 'kind')::public.resource_kind,
            resource_json ->> 'url',
            resource_json ->> 'externalId',
            coalesce((resource_json ->> 'position')::integer, 0),
            null
          )
          on conflict (id) do update set
            node_id = excluded.node_id,
            kind = excluded.kind,
            url = excluded.url,
            external_id = excluded.external_id,
            position = excluded.position,
            archived_at = null,
            updated_at = now()
          where public.resource_bindings.owner_id = current_user_id;
        end loop;
      end loop;
    end loop;
  end loop;

  select exists (
    select 1
    from public.path_node_dependencies dependency
    join public.path_nodes node on node.id = dependency.node_id and node.owner_id = dependency.owner_id
    join public.stages stage on stage.id = node.stage_id and stage.owner_id = node.owner_id
    join public.path_nodes prerequisite on prerequisite.id = dependency.dependency_id
      and prerequisite.owner_id = dependency.owner_id
    join public.stages prerequisite_stage on prerequisite_stage.id = prerequisite.stage_id
      and prerequisite_stage.owner_id = prerequisite.owner_id
    where dependency.owner_id = current_user_id
      and node.archived_at is null
      and prerequisite.archived_at is null
      and stage.goal_id <> prerequisite_stage.goal_id
  ) into invalid_dependency;
  if invalid_dependency then
    raise exception using errcode = '23514', message = 'DEPENDENCY_MUST_STAY_INSIDE_GOAL';
  end if;

  with recursive dependency_walk(node_id, dependency_id, path, cycle) as (
    select dependency.node_id,
      dependency.dependency_id,
      array[dependency.node_id, dependency.dependency_id],
      dependency.node_id = dependency.dependency_id
    from public.path_node_dependencies dependency
    join public.path_nodes node on node.id = dependency.node_id
      and node.owner_id = dependency.owner_id and node.archived_at is null
    where dependency.owner_id = current_user_id
    union all
    select walk.node_id,
      dependency.dependency_id,
      walk.path || dependency.dependency_id,
      dependency.dependency_id = any(walk.path)
    from dependency_walk walk
    join public.path_node_dependencies dependency
      on dependency.node_id = walk.dependency_id and dependency.owner_id = current_user_id
    where not walk.cycle
  )
  select exists (select 1 from dependency_walk where cycle) into invalid_dependency;
  if invalid_dependency then
    raise exception using errcode = '23514', message = 'DEPENDENCY_CYCLE';
  end if;

  next_version := current_version + 1;
  update public.blueprints
  set title = snapshot ->> 'title', version = next_version, updated_at = now()
  where id = proposal.blueprint_id and owner_id = current_user_id;

  update public.blueprint_proposals
  set status = 'applied', applied_mutation_id = target_mutation_id, applied_at = now()
  where id = proposal.id and owner_id = current_user_id;

  insert into public.blueprint_revisions (owner_id, blueprint_id, proposal_id, version, snapshot)
  values (current_user_id, proposal.blueprint_id, proposal.id, next_version, jsonb_set(snapshot, '{version}', to_jsonb(next_version)));

  return next_version;
end;
$$;

alter table public.profiles enable row level security;
alter table public.blueprints enable row level security;
alter table public.goals enable row level security;
alter table public.stages enable row level security;
alter table public.path_nodes enable row level security;
alter table public.path_node_dependencies enable row level security;
alter table public.resource_bindings enable row level security;
alter table public.blueprint_proposals enable row level security;
alter table public.blueprint_revisions enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.product_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.blueprints, public.goals, public.stages, public.path_nodes,
  public.path_node_dependencies, public.resource_bindings, public.blueprint_revisions to authenticated;
grant select, insert, update on public.blueprint_proposals to authenticated;
grant select, insert on public.learning_sessions to authenticated;
grant select, insert on public.product_events to authenticated;
revoke all on function public.apply_blueprint_proposal(uuid, bigint, uuid) from public, anon;
grant execute on function public.apply_blueprint_proposal(uuid, bigint, uuid) to authenticated;

create policy profiles_owner_select on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_owner_update on public.profiles for update to authenticated
using ((select auth.uid()) = id and not private.is_extension_client())
with check ((select auth.uid()) = id and not private.is_extension_client());

create policy blueprints_owner_select on public.blueprints for select to authenticated
using ((select auth.uid()) = owner_id);
create policy goals_owner_select on public.goals for select to authenticated using ((select auth.uid()) = owner_id);
create policy stages_owner_select on public.stages for select to authenticated using ((select auth.uid()) = owner_id);
create policy path_nodes_owner_select on public.path_nodes for select to authenticated using ((select auth.uid()) = owner_id);
create policy dependencies_owner_select on public.path_node_dependencies for select to authenticated using ((select auth.uid()) = owner_id);
create policy resources_owner_select on public.resource_bindings for select to authenticated using ((select auth.uid()) = owner_id);

create policy proposals_web_select on public.blueprint_proposals for select to authenticated
using ((select auth.uid()) = owner_id and not private.is_extension_client());
create policy proposals_web_insert on public.blueprint_proposals for insert to authenticated
with check ((select auth.uid()) = owner_id and not private.is_extension_client());
create policy proposals_web_update on public.blueprint_proposals for update to authenticated
using ((select auth.uid()) = owner_id and not private.is_extension_client())
with check ((select auth.uid()) = owner_id and not private.is_extension_client());

create policy revisions_web_select on public.blueprint_revisions for select to authenticated
using ((select auth.uid()) = owner_id and not private.is_extension_client());
create policy sessions_owner_select on public.learning_sessions for select to authenticated
using ((select auth.uid()) = owner_id);
create policy sessions_owner_insert on public.learning_sessions for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy events_owner_select on public.product_events for select to authenticated
using ((select auth.uid()) = owner_id and not private.is_extension_client());
create policy events_owner_insert on public.product_events for insert to authenticated
with check ((select auth.uid()) = owner_id);
