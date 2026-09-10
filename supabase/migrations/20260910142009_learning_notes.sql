-- Reviewed CLI local pull: explicit ACLs retained; helpers precede public wrappers.
-- Append-only private user notes; PostgreSQL UTF-8 rejects NUL/unpaired surrogates.
create table public.learning_notes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 client_mutation_id uuid not null,
 blueprint_id uuid not null, blueprint_version bigint not null check(blueprint_version between 0 and 9007199254740991),
 goal_id uuid not null, goal_title text not null,
 stage_id uuid not null, stage_title text not null,
 node_id uuid not null, node_title text not null, node_type public.path_node_type not null,
 resource_binding_id uuid not null, video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
 resource_url text not null check(resource_url = 'https://www.youtube.com/watch?v=' || video_id),
 position_seconds integer check(position_seconds >= 0),
 note_text text not null check(char_length(note_text) between 1 and 8000 and
  btrim(note_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''),
 created_at timestamptz not null default clock_timestamp(),
 unique(owner_id,client_mutation_id)
);
create index learning_notes_owner_recent_idx on public.learning_notes(owner_id,created_at desc,id desc);
alter table public.learning_notes enable row level security;
revoke all on public.learning_notes from public,anon,authenticated,service_role;
grant select on public.learning_notes to authenticated;
create policy learning_notes_owner_read on public.learning_notes for select to authenticated
 using((select auth.uid())=owner_id and (select private.can_access_progress_evidence())
  and coalesce((select auth.jwt())->>'is_anonymous','false')='false');

create function private.record_learning_note(
 p_node_id uuid,p_resource_binding_id uuid,p_expected_version bigint,p_note_text text,p_position_seconds integer,p_client_mutation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); blueprint public.blueprints; context record; receipt public.learning_notes;
begin
 if actor is null or not private.can_access_progress_evidence() or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'LEARNING_NOTE_FORBIDDEN' using errcode='42501';
 end if;
 if p_node_id is null or p_resource_binding_id is null or p_client_mutation_id is null
  or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
  or p_position_seconds<0 or p_note_text is null or char_length(p_note_text) not between 1 and 8000
  or btrim(p_note_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' then
  raise exception 'LEARNING_NOTE_INVALID' using errcode='22023';
 end if;
 -- Same lock order as formal proposal application; replay wins over changed source.
 select * into blueprint from public.blueprints where owner_id=actor for update;
 if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode='P0002'; end if;
 select * into receipt from public.learning_notes where owner_id=actor and client_mutation_id=p_client_mutation_id;
 if found then
  if receipt.node_id<>p_node_id or receipt.resource_binding_id<>p_resource_binding_id or receipt.blueprint_version<>p_expected_version
   or receipt.note_text<>p_note_text or receipt.position_seconds is distinct from p_position_seconds then
   raise exception 'LEARNING_NOTE_MUTATION_REUSED' using errcode='22023';
  end if;
  return to_jsonb(receipt);
 end if;
 if blueprint.version<>p_expected_version then raise exception 'BLUEPRINT_VERSION_CONFLICT' using errcode='40001'; end if;
 select n.title node_title,n.node_type,s.id stage_id,s.title stage_title,g.id goal_id,g.title goal_title,r.external_id,r.url
 into context from public.path_nodes n
 join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id
 join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
 join public.resource_bindings r on r.node_id=n.id and r.owner_id=n.owner_id
 where n.id=p_node_id and n.owner_id=actor and g.blueprint_id=blueprint.id and r.id=p_resource_binding_id
  and n.archived_at is null and s.archived_at is null and g.archived_at is null and r.archived_at is null
  and r.kind='youtube_video' and r.external_id ~ '^[A-Za-z0-9_-]{11}$'
  and r.url='https://www.youtube.com/watch?v='||r.external_id;
 if not found then raise exception 'LEARNING_NOTE_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
 insert into public.learning_notes(owner_id,client_mutation_id,blueprint_id,blueprint_version,goal_id,goal_title,
  stage_id,stage_title,node_id,node_title,node_type,resource_binding_id,video_id,resource_url,position_seconds,note_text)
 values(actor,p_client_mutation_id,blueprint.id,blueprint.version,context.goal_id,context.goal_title,
  context.stage_id,context.stage_title,p_node_id,context.node_title,context.node_type,p_resource_binding_id,
  context.external_id,context.url,p_position_seconds,p_note_text) returning * into receipt;
 return to_jsonb(receipt);
end $$;
revoke all on function private.record_learning_note(uuid,uuid,bigint,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.record_learning_note(uuid,uuid,bigint,text,integer,uuid) to authenticated;
create function public.record_learning_note(
 p_node_id uuid,p_resource_binding_id uuid,p_expected_version bigint,p_note_text text,p_position_seconds integer,p_client_mutation_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select private.record_learning_note(p_node_id,p_resource_binding_id,p_expected_version,p_note_text,p_position_seconds,p_client_mutation_id)
$$;
revoke all on function public.record_learning_note(uuid,uuid,bigint,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_learning_note(uuid,uuid,bigint,text,integer,uuid) to authenticated;

-- STABLE gives the formal path and saved history a single statement snapshot.
create function public.read_learning_note_workspace(p_owner_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('blueprint',public.read_blueprint_snapshot_v2(p_owner_id),
  'records',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc,recent.id desc) from (
   select note.* from public.learning_notes note where note.owner_id=p_owner_id
   order by note.created_at desc,note.id desc limit 50
  ) recent),'[]'::jsonb))
 from public.blueprints b where b.owner_id=p_owner_id and p_owner_id=(select auth.uid())
  and (select private.can_access_progress_evidence()) and coalesce((select auth.jwt())->>'is_anonymous','false')='false'
$$;
revoke all on function public.read_learning_note_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_learning_note_workspace(uuid) to authenticated;
