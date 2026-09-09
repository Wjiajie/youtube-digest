-- Additive hardening of the confirmed-proposal write path; no stored data changes.
-- The legacy helper name is retained for existing RLS policies. All OAuth-bound
-- sessions lack Web-only privileges, independently of the extension configuration.
CREATE OR REPLACE FUNCTION private.is_extension_client()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
  select (select auth.jwt() ->> 'client_id') is not null
$function$
;

CREATE OR REPLACE FUNCTION public.apply_blueprint_proposal(proposal_id uuid, expected_version bigint, mutation_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if target_proposal_id is null or target_expected_version is null
    or target_expected_version < 0 or target_mutation_id is null then
    raise exception using errcode = '22023', message = 'PROPOSAL_ARGUMENTS_INVALID';
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
  if snapshot ->> 'id' is distinct from proposal.blueprint_id::text then
    raise exception using errcode = '23514', message = 'BLUEPRINT_ID_MISMATCH';
  end if;
  if jsonb_typeof(snapshot) is distinct from 'object'
    or snapshot -> 'schemaVersion' is distinct from '1'::jsonb
    or snapshot -> 'version' is distinct from to_jsonb(proposal.base_version)
    or jsonb_typeof(snapshot -> 'title') is distinct from 'string'
    or char_length(btrim(snapshot ->> 'title')) not between 1 and 240
    or jsonb_typeof(snapshot -> 'goals') is distinct from 'array' then
    raise exception using errcode = '23514', message = 'BLUEPRINT_SNAPSHOT_INVALID';
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

  for goal_json in select value from jsonb_array_elements(snapshot -> 'goals') loop
    if jsonb_typeof(goal_json -> 'stages') is distinct from 'array' then
      raise exception using errcode = '23514', message = 'BLUEPRINT_SNAPSHOT_INVALID';
    end if;
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

    for stage_json in select value from jsonb_array_elements(goal_json -> 'stages') loop
      if jsonb_typeof(stage_json -> 'nodes') is distinct from 'array' then
        raise exception using errcode = '23514', message = 'BLUEPRINT_SNAPSHOT_INVALID';
      end if;
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

      for node_json in select value from jsonb_array_elements(stage_json -> 'nodes') loop
        if jsonb_typeof(node_json -> 'dependencyIds') is distinct from 'array'
          or jsonb_typeof(node_json -> 'resources') is distinct from 'array' then
          raise exception using errcode = '23514', message = 'BLUEPRINT_SNAPSHOT_INVALID';
        end if;
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

        for dependency_json in select value from jsonb_array_elements(node_json -> 'dependencyIds') loop
          insert into public.path_node_dependencies (owner_id, node_id, dependency_id)
          values (current_user_id, (node_json ->> 'id')::uuid, (dependency_json #>> '{}')::uuid);
        end loop;

        for resource_json in select value from jsonb_array_elements(node_json -> 'resources') loop
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
$function$
;

-- Keep the existing narrow caller grants explicit when replaying the migration.
revoke all on function private.is_extension_client() from public, anon;
grant execute on function private.is_extension_client() to authenticated;
revoke all on function public.apply_blueprint_proposal(uuid, bigint, uuid) from public, anon;
grant execute on function public.apply_blueprint_proposal(uuid, bigint, uuid) to authenticated;
