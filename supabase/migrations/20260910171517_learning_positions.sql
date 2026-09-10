-- Explicit append-only learning positions; no playback tracking or progress inference.
-- Generated from incrementally verified local DDL; existing rows remain untouched.
  create table "public"."learning_positions" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "client_mutation_id" uuid not null,
    "blueprint_id" uuid not null,
    "blueprint_version" integer not null,
    "goal_id" uuid not null,
    "goal_title" text not null,
    "stage_id" uuid not null,
    "stage_title" text not null,
    "node_id" uuid not null,
    "node_title" text not null,
    "node_type" public.path_node_type not null,
    "resource_binding_id" uuid not null,
    "video_id" text not null,
    "resource_url" text not null,
    "expected_position_version" integer not null,
    "position_version" integer not null,
    "position_seconds" integer not null,
    "created_at" timestamp with time zone not null default clock_timestamp()
      );


alter table "public"."learning_positions" enable row level security;

CREATE UNIQUE INDEX learning_positions_owner_id_client_mutation_id_key ON public.learning_positions USING btree (owner_id, client_mutation_id);

CREATE UNIQUE INDEX learning_positions_owner_id_resource_binding_id_position_ve_key ON public.learning_positions USING btree (owner_id, resource_binding_id, position_version);

CREATE INDEX learning_positions_owner_recent_idx ON public.learning_positions USING btree (owner_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX learning_positions_pkey ON public.learning_positions USING btree (id);

alter table "public"."learning_positions" add constraint "learning_positions_pkey" PRIMARY KEY using index "learning_positions_pkey";

alter table "public"."learning_positions" add constraint "learning_positions_blueprint_version_check" CHECK ((blueprint_version >= 0)) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_blueprint_version_check";

alter table "public"."learning_positions" add constraint "learning_positions_check" CHECK ((resource_url = ('https://www.youtube.com/watch?v='::text || video_id))) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_check";

alter table "public"."learning_positions" add constraint "learning_positions_check1" CHECK (((position_version)::bigint = ((expected_position_version)::bigint + 1))) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_check1";

alter table "public"."learning_positions" add constraint "learning_positions_expected_position_version_check" CHECK (((expected_position_version >= 0) AND (expected_position_version <= 2147483646))) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_expected_position_version_check";

alter table "public"."learning_positions" add constraint "learning_positions_owner_id_client_mutation_id_key" UNIQUE using index "learning_positions_owner_id_client_mutation_id_key";

alter table "public"."learning_positions" add constraint "learning_positions_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_owner_id_fkey";

alter table "public"."learning_positions" add constraint "learning_positions_owner_id_resource_binding_id_position_ve_key" UNIQUE using index "learning_positions_owner_id_resource_binding_id_position_ve_key";

alter table "public"."learning_positions" add constraint "learning_positions_position_seconds_check" CHECK ((position_seconds >= 0)) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_position_seconds_check";

alter table "public"."learning_positions" add constraint "learning_positions_video_id_check" CHECK ((video_id ~ '^[A-Za-z0-9_-]{11}$'::text)) not valid;

alter table "public"."learning_positions" validate constraint "learning_positions_video_id_check";

CREATE OR REPLACE FUNCTION public.read_learning_position_workspace(p_owner_id uuid, p_resource_binding_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('blueprint',public.read_blueprint_snapshot_v2(p_owner_id),
  'records',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc,recent.id desc) from (
   select latest.* from (
    select distinct on (resource_binding_id) position.* from public.learning_positions position where position.owner_id=p_owner_id
      and (p_resource_binding_id is null or position.resource_binding_id=p_resource_binding_id)
    order by resource_binding_id desc,position_version desc
   ) latest order by latest.created_at desc,latest.id desc limit 50
  ) recent),'[]'::jsonb))
 from public.blueprints b where b.owner_id=p_owner_id and p_owner_id=(select auth.uid())
  and (select private.can_access_progress_evidence()) and coalesce((select auth.jwt())->>'is_anonymous','false')='false'
$function$
;

revoke all on table public.learning_positions from public, anon, authenticated, service_role;
grant select on table "public"."learning_positions" to "authenticated";


  create policy "learning_positions_owner_read"
  on "public"."learning_positions"
  as permissive
  for select
  to authenticated
using (((( SELECT auth.uid() AS uid) = owner_id) AND ( SELECT private.can_access_progress_evidence() AS can_access_progress_evidence) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) = 'false'::text)));


CREATE OR REPLACE FUNCTION private.record_learning_position(p_node_id uuid, p_resource_binding_id uuid, p_expected_version integer, p_expected_position_version integer, p_position_seconds integer, p_client_mutation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); blueprint public.blueprints; context record; receipt public.learning_positions; latest integer;
begin
 if actor is null or not private.can_access_progress_evidence() or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'LEARNING_POSITION_FORBIDDEN' using errcode='42501';
 end if;
 if p_node_id is null or p_resource_binding_id is null or p_client_mutation_id is null or p_expected_version is null or p_expected_version<0
  or p_expected_position_version is null or p_expected_position_version not between 0 and 2147483646 or p_position_seconds is null or p_position_seconds<0 then
  raise exception 'LEARNING_POSITION_INVALID' using errcode='22023';
 end if;
 -- Common Blueprint lock serializes source changes and concurrent device saves.
 select * into blueprint from public.blueprints where owner_id=actor for update;
 if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode='P0002'; end if;
 select * into receipt from public.learning_positions where owner_id=actor and client_mutation_id=p_client_mutation_id;
 if found then
  if receipt.node_id<>p_node_id or receipt.resource_binding_id<>p_resource_binding_id or receipt.blueprint_version<>p_expected_version
   or receipt.expected_position_version<>p_expected_position_version or receipt.position_seconds<>p_position_seconds then
   raise exception 'LEARNING_POSITION_MUTATION_REUSED' using errcode='22023';
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
  and r.kind='youtube_video' and r.external_id ~ '^[A-Za-z0-9_-]{11}$' and r.url='https://www.youtube.com/watch?v='||r.external_id;
 if not found then raise exception 'LEARNING_POSITION_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
 select position_version into latest from public.learning_positions where owner_id=actor and resource_binding_id=p_resource_binding_id order by position_version desc limit 1;
 if coalesce(latest,0)<>p_expected_position_version then raise exception 'LEARNING_POSITION_VERSION_CONFLICT' using errcode='40001'; end if;
 insert into public.learning_positions(owner_id,client_mutation_id,blueprint_id,blueprint_version,goal_id,goal_title,stage_id,stage_title,node_id,node_title,node_type,
  resource_binding_id,video_id,resource_url,expected_position_version,position_version,position_seconds)
 values(actor,p_client_mutation_id,blueprint.id,blueprint.version,context.goal_id,context.goal_title,context.stage_id,context.stage_title,p_node_id,context.node_title,context.node_type,
  p_resource_binding_id,context.external_id,context.url,p_expected_position_version,p_expected_position_version+1,p_position_seconds) returning * into receipt;
 return to_jsonb(receipt);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_learning_position(p_node_id uuid, p_resource_binding_id uuid, p_expected_version integer, p_expected_position_version integer, p_position_seconds integer, p_client_mutation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
 select private.record_learning_position(p_node_id,p_resource_binding_id,p_expected_version,p_expected_position_version,p_position_seconds,p_client_mutation_id)
$function$
;

-- CLI schema diff omits routine ACLs; explicitly preserve the verified local boundary.
revoke all on function private.record_learning_position(uuid,uuid,integer,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.record_learning_position(uuid,uuid,integer,integer,integer,uuid) to authenticated;
revoke all on function public.record_learning_position(uuid,uuid,integer,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_learning_position(uuid,uuid,integer,integer,integer,uuid) to authenticated;
revoke all on function public.read_learning_position_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_learning_position_workspace(uuid,uuid) to authenticated;
