-- Generated from reviewed local DDL. No existing business rows or Blueprint
-- snapshots are rewritten. Explicit client ACLs are restored below.

  create table "private"."node_status_mutations" (
    "owner_id" uuid not null,
    "client_mutation_id" uuid not null,
    "request" jsonb not null,
    "confirmation_id" uuid not null
      );


alter table "private"."node_status_mutations" enable row level security;


  create table "public"."node_status_confirmations" (
    "id" uuid not null default gen_random_uuid(),
    "owner_id" uuid not null,
    "client_mutation_id" uuid not null,
    "blueprint_id" uuid not null,
    "blueprint_version" bigint not null,
    "goal_id" uuid not null,
    "goal_title" text not null,
    "stage_id" uuid not null,
    "stage_title" text not null,
    "node_id" uuid not null,
    "node_title" text not null,
    "node_type" public.path_node_type not null,
    "estimated_minutes" integer,
    "completion_criteria" text not null,
    "status" text not null,
    "revision" integer not null,
    "evidence_id" uuid,
    "created_at" timestamp with time zone not null default clock_timestamp()
      );


alter table "public"."node_status_confirmations" enable row level security;

CREATE INDEX node_status_mutations_confirmation_idx ON private.node_status_mutations USING btree (confirmation_id);

CREATE UNIQUE INDEX node_status_mutations_pkey ON private.node_status_mutations USING btree (owner_id, client_mutation_id);

CREATE UNIQUE INDEX node_status_confirmations_owner_id_client_mutation_id_key ON public.node_status_confirmations USING btree (owner_id, client_mutation_id);

CREATE UNIQUE INDEX node_status_confirmations_owner_id_node_id_revision_key ON public.node_status_confirmations USING btree (owner_id, node_id, revision);

CREATE INDEX node_status_confirmations_owner_recent_idx ON public.node_status_confirmations USING btree (owner_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX node_status_confirmations_pkey ON public.node_status_confirmations USING btree (id);

alter table "private"."node_status_mutations" add constraint "node_status_mutations_pkey" PRIMARY KEY using index "node_status_mutations_pkey";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_pkey" PRIMARY KEY using index "node_status_confirmations_pkey";

alter table "private"."node_status_mutations" add constraint "node_status_mutations_confirmation_id_fkey" FOREIGN KEY (confirmation_id) REFERENCES public.node_status_confirmations(id) ON DELETE CASCADE not valid;

alter table "private"."node_status_mutations" validate constraint "node_status_mutations_confirmation_id_fkey";

alter table "private"."node_status_mutations" add constraint "node_status_mutations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."node_status_mutations" validate constraint "node_status_mutations_owner_id_fkey";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_blueprint_version_check" CHECK ((blueprint_version >= 0)) not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_blueprint_version_check";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_check" CHECK (((evidence_id IS NULL) OR (status = 'completed'::text))) not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_check";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_estimated_minutes_check" CHECK ((estimated_minutes >= 1)) not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_estimated_minutes_check";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_owner_id_client_mutation_id_key" UNIQUE using index "node_status_confirmations_owner_id_client_mutation_id_key";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_owner_id_fkey";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_owner_id_node_id_revision_key" UNIQUE using index "node_status_confirmations_owner_id_node_id_revision_key";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_revision_check" CHECK ((revision >= 1)) not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_revision_check";

alter table "public"."node_status_confirmations" add constraint "node_status_confirmations_status_check" CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text]))) not valid;

alter table "public"."node_status_confirmations" validate constraint "node_status_confirmations_status_check";

CREATE OR REPLACE FUNCTION private.confirm_node_status(p_node_id uuid, p_expected_version integer, p_expected_status_revision integer, p_status text, p_evidence_id uuid, p_client_mutation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid(); root public.blueprints; context record;
 result public.node_status_confirmations; current_revision integer;
 request_value jsonb; receipt private.node_status_mutations;
begin
 if actor is null or not private.can_access_progress_evidence() then raise exception 'NODE_STATUS_FORBIDDEN' using errcode='42501'; end if;
 if p_node_id is null or p_expected_version is null or p_expected_version<0
  or p_expected_status_revision is null or p_expected_status_revision not between 0 and 2147483646
  or p_status is null or p_status not in ('not_started','in_progress','completed')
  or p_client_mutation_id is null or (p_evidence_id is not null and p_status<>'completed') then
  raise exception 'NODE_STATUS_INVALID' using errcode='22023';
 end if;
 select * into root from public.blueprints where owner_id=actor for update;
 if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode='P0002'; end if;
 request_value:=jsonb_build_object('node_id',p_node_id,'expected_version',p_expected_version,
  'expected_status_revision',p_expected_status_revision,'status',p_status,'evidence_id',p_evidence_id);
 select * into receipt from private.node_status_mutations where owner_id=actor and client_mutation_id=p_client_mutation_id;
 if found then
  if receipt.request<>request_value then raise exception 'NODE_STATUS_MUTATION_REUSED' using errcode='22023'; end if;
  select * into strict result from public.node_status_confirmations where id=receipt.confirmation_id and owner_id=actor;
  return to_jsonb(result);
 end if;
 if root.version<>p_expected_version then raise exception 'BLUEPRINT_VERSION_CONFLICT' using errcode='40001'; end if;
 select coalesce(max(revision),0) into current_revision from public.node_status_confirmations where owner_id=actor and node_id=p_node_id;
 if current_revision<>p_expected_status_revision then raise exception 'NODE_STATUS_VERSION_CONFLICT' using errcode='40001'; end if;
 select n.title node_title,n.node_type,n.estimated_minutes,n.completion_criteria,
  s.id stage_id,s.title stage_title,g.id goal_id,g.title goal_title into context
 from public.path_nodes n join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id
 join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
 where n.id=p_node_id and n.owner_id=actor and g.blueprint_id=root.id
  and n.archived_at is null and s.archived_at is null and g.archived_at is null;
 if not found then raise exception 'PATH_NODE_NOT_FOUND' using errcode='P0002'; end if;
 if p_evidence_id is not null and not exists(
  select 1 from public.progress_evidence where id=p_evidence_id and owner_id=actor and node_id=p_node_id
 ) then raise exception 'NODE_STATUS_EVIDENCE_INVALID' using errcode='22023'; end if;
 insert into public.node_status_confirmations(owner_id,client_mutation_id,blueprint_id,blueprint_version,
  goal_id,goal_title,stage_id,stage_title,node_id,node_title,node_type,estimated_minutes,completion_criteria,status,revision,evidence_id)
 values(actor,p_client_mutation_id,root.id,root.version,context.goal_id,context.goal_title,context.stage_id,context.stage_title,
  p_node_id,context.node_title,context.node_type,context.estimated_minutes,context.completion_criteria,p_status,current_revision+1,p_evidence_id)
 returning * into result;
 insert into private.node_status_mutations(owner_id,client_mutation_id,request,confirmation_id)
 values(actor,p_client_mutation_id,request_value,result.id);
 return to_jsonb(result);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_node_status(p_node_id uuid, p_expected_version integer, p_expected_status_revision integer, p_status text, p_evidence_id uuid, p_client_mutation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$ select private.confirm_node_status(p_node_id,p_expected_version,p_expected_status_revision,p_status,p_evidence_id,p_client_mutation_id) $function$
;

CREATE OR REPLACE FUNCTION public.read_node_status_workspace(p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'blueprint',public.read_blueprint_snapshot_v2(p_owner_id),
  'current',coalesce((select jsonb_agg(to_jsonb(latest) order by latest.node_id) from (
   select distinct on(c.node_id) c.* from public.node_status_confirmations c
   join public.path_nodes n on n.id=c.node_id and n.owner_id=c.owner_id
   join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id
   join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
   where c.owner_id=p_owner_id and g.blueprint_id=b.id
    and n.archived_at is null and s.archived_at is null and g.archived_at is null
   order by c.node_id,c.revision desc
  ) latest),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc,recent.id desc) from (
   select c.* from public.node_status_confirmations c where c.owner_id=p_owner_id
   order by c.created_at desc,c.id desc limit 50
  ) recent),'[]'::jsonb)
 ) from public.blueprints b where b.owner_id=p_owner_id and p_owner_id=(select auth.uid())
  and (select private.can_access_progress_evidence())
$function$
;

revoke all on table private.node_status_mutations from public, anon, authenticated;
revoke all on table public.node_status_confirmations from public, anon, authenticated;
grant select on table public.node_status_confirmations to authenticated;

revoke all on function private.confirm_node_status(uuid,integer,integer,text,uuid,uuid) from public, anon, authenticated;
grant execute on function private.confirm_node_status(uuid,integer,integer,text,uuid,uuid) to authenticated;
revoke all on function public.confirm_node_status(uuid,integer,integer,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.confirm_node_status(uuid,integer,integer,text,uuid,uuid) to authenticated;
revoke all on function public.read_node_status_workspace(uuid) from public, anon, authenticated;
grant execute on function public.read_node_status_workspace(uuid) to authenticated;

grant references on table "public"."node_status_confirmations" to "service_role";

grant trigger on table "public"."node_status_confirmations" to "service_role";

grant truncate on table "public"."node_status_confirmations" to "service_role";


  create policy "node_status_owner_read"
  on "public"."node_status_confirmations"
  as permissive
  for select
  to authenticated
using (((( SELECT auth.uid() AS uid) = owner_id) AND ( SELECT private.can_access_progress_evidence() AS can_access_progress_evidence)));
