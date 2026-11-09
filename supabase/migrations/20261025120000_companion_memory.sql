-- Summaries are private conversation data, never formal goal/action receipts.
create table public.companion_memories (
 conversation_id uuid primary key,
 owner_id uuid not null,
 revision integer not null check(revision>0),
 content jsonb not null check(jsonb_typeof(content)='object' and octet_length(content::text)<=24576),
 through_id uuid not null,
 through_created_at timestamptz not null,
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(conversation_id,owner_id) references public.companion_conversations(id,owner_id) on delete cascade
);
alter table public.companion_memories enable row level security;
revoke all on public.companion_memories from public,anon,authenticated,service_role;
grant select on public.companion_memories to authenticated;
create policy companion_memory_owner on public.companion_memories for select to authenticated
 using(owner_id=(select auth.uid()) and not(select private.is_extension_client()) and
 ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);

create function public.read_companion_context(p_conversation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); m public.companion_memories; pending jsonb; recent jsonb;
begin
 if actor is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then
  raise exception 'COMPANION_FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.companion_conversations where id=p_conversation_id and owner_id=actor) then
  raise exception 'COMPANION_NOT_FOUND' using errcode='P0002'; end if;
 select * into m from public.companion_memories where conversation_id=p_conversation_id and owner_id=actor;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into pending from (
  select id,role,text,modality,interrupted,created_at from public.companion_messages
  where conversation_id=p_conversation_id and owner_id=actor and not interrupted
   and (m.through_id is null or (created_at,id)>(m.through_created_at,m.through_id))
  order by created_at,id limit 64
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into recent from (
  select id,role,text,modality,interrupted,created_at from public.companion_messages
  where conversation_id=p_conversation_id and owner_id=actor and not interrupted
  order by created_at desc,id desc limit 20
 ) x;
 return jsonb_build_object('memory',case when m.conversation_id is null then null else to_jsonb(m) end,
  'pending',pending,'recent',recent);
end $$;

create function public.save_companion_memory(p_conversation_id uuid,p_expected_revision integer,p_through_id uuid,p_content jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); m public.companion_memories; boundary public.companion_messages;
begin
 if actor is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then
  raise exception 'COMPANION_FORBIDDEN' using errcode='42501'; end if;
 -- Serialize with deletion so an in-flight summary cannot resurrect cleared data.
 perform 1 from public.companion_conversations where id=p_conversation_id and owner_id=actor for update;
 if not found then raise exception 'COMPANION_NOT_FOUND' using errcode='P0002'; end if;
 select * into m from public.companion_memories where conversation_id=p_conversation_id and owner_id=actor for update;
 if coalesce(m.revision,0) is distinct from p_expected_revision then
  raise exception 'COMPANION_MEMORY_CONFLICT' using errcode='40001'; end if;
 select * into boundary from public.companion_messages where id=p_through_id and conversation_id=p_conversation_id and owner_id=actor and not interrupted;
 if not found or (m.through_id is not null and (boundary.created_at,boundary.id)<=(m.through_created_at,m.through_id)) then
  raise exception 'COMPANION_MEMORY_BOUNDARY' using errcode='40001'; end if;
 if p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>24576
  or jsonb_typeof(p_content->'summary') is distinct from 'string' or length(btrim(p_content->>'summary')) not between 1 and 3000
  or jsonb_typeof(p_content->'facts') is distinct from 'array' or jsonb_typeof(p_content->'openQuestions') is distinct from 'array' then
  raise exception 'COMPANION_MEMORY_INVALID' using errcode='22023'; end if;
 if jsonb_array_length(p_content->'facts')>20 or jsonb_array_length(p_content->'openQuestions')>8
  or exists(select 1 from jsonb_array_elements((p_content->'facts')||(p_content->'openQuestions')) v
    where jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 220) then
  raise exception 'COMPANION_MEMORY_INVALID' using errcode='22023'; end if;
 insert into public.companion_memories(conversation_id,owner_id,revision,content,through_id,through_created_at)
 values(p_conversation_id,actor,coalesce(m.revision,0)+1,p_content,boundary.id,boundary.created_at)
 on conflict(conversation_id) do update set revision=excluded.revision,content=excluded.content,
  through_id=excluded.through_id,through_created_at=excluded.through_created_at,updated_at=clock_timestamp()
 returning * into m;
 return to_jsonb(m);
end $$;
revoke all on function public.read_companion_context(uuid),public.save_companion_memory(uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_companion_context(uuid),public.save_companion_memory(uuid,integer,uuid,jsonb) to authenticated;
