-- One coherent read of formal entities, preserving caller RLS and privileges.
-- No existing rows, extension installations or proposal write rules are changed.

CREATE OR REPLACE FUNCTION public.read_blueprint_snapshot(p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1, 'id', b.id, 'version', b.version, 'title', b.title,
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'description', g.description, 'position', g.position,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'title', s.title, 'position', s.position,
            'nodes', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', n.id, 'type', n.node_type, 'title', n.title,
                'description', n.description, 'position', n.position,
                'dependencyIds', coalesce((
                  select jsonb_agg(d.dependency_id order by d.dependency_id)
                  from public.path_node_dependencies d where d.node_id = n.id and d.owner_id = b.owner_id
                ), '[]'::jsonb),
                'resources', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'kind', r.kind, 'url', r.url, 'externalId', r.external_id
                  ) order by r.position, r.id)
                  from public.resource_bindings r
                  where r.node_id = n.id and r.owner_id = b.owner_id and r.archived_at is null
                ), '[]'::jsonb)
              ) order by n.position, n.id)
              from public.path_nodes n
              where n.stage_id = s.id and n.owner_id = b.owner_id and n.archived_at is null
            ), '[]'::jsonb)
          ) order by s.position, s.id)
          from public.stages s
          where s.goal_id = g.id and s.owner_id = b.owner_id and s.archived_at is null
        ), '[]'::jsonb)
      ) order by g.position, g.id)
      from public.goals g
      where g.blueprint_id = b.id and g.owner_id = b.owner_id and g.archived_at is null
    ), '[]'::jsonb)
  ))
  from public.blueprints b
  where b.owner_id = p_owner_id and p_owner_id = (select auth.uid())
    and (select private.can_access_progress_evidence())
$function$
;
revoke all on function public.read_blueprint_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.read_blueprint_snapshot(uuid) to authenticated;
