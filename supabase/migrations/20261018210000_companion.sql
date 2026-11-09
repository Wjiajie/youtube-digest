-- Companion conversation is private Web data. Formal mutations remain behind existing RPCs.
create table public.companion_conversations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), unique(id,owner_id)
);
create table public.companion_messages (
 id uuid primary key, conversation_id uuid not null, owner_id uuid not null,
 role text not null check(role in ('user','assistant')), modality text not null check(modality in ('text','voice')),
 text text not null check(length(text) between 1 and 16000), interrupted boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), unique(id,conversation_id,owner_id),
 foreign key(conversation_id,owner_id) references public.companion_conversations(id,owner_id) on delete cascade
);
create index companion_messages_recent on public.companion_messages(conversation_id,created_at desc,id desc);
create table public.companion_actions (
 id uuid primary key, conversation_id uuid not null, owner_id uuid not null, source_message_id uuid not null,
 kind text not null check(kind in ('goal','progress','plan','planning')), payload jsonb not null,
 call_key text not null check(length(call_key) between 1 and 200), status text not null default 'pending' check(status in ('pending','applied','cancelled')),
 receipt jsonb, confirmed_message_id uuid, created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 unique(owner_id,call_key), unique(owner_id,confirmed_message_id), foreign key(conversation_id,owner_id) references public.companion_conversations(id,owner_id) on delete cascade,
 foreign key(source_message_id,conversation_id,owner_id) references public.companion_messages(id,conversation_id,owner_id) on delete cascade
);
create index companion_actions_recent on public.companion_actions(conversation_id,created_at desc,id desc);
create table public.companion_preferences (
 owner_id uuid primary key references auth.users(id) on delete cascade, value jsonb not null,
 revision integer not null default 1 check(revision>0)
);
do $$ declare t text; begin
 foreach t in array array['companion_conversations','companion_messages','companion_actions','companion_preferences'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,delete on public.%I to authenticated',t);
  execute format('create policy companion_owner on public.%I for all to authenticated using (owner_id=(select auth.uid()) and not(select private.is_extension_client()) and ((select auth.jwt())->''is_anonymous'') is distinct from ''true''::jsonb) with check(owner_id=(select auth.uid()) and not(select private.is_extension_client()) and ((select auth.jwt())->''is_anonymous'') is distinct from ''true''::jsonb)',t);
 end loop;
end $$;
revoke insert on public.companion_actions from authenticated;
grant insert(id,conversation_id,owner_id,source_message_id,kind,payload,call_key) on public.companion_actions to authenticated;
grant update(value,revision) on public.companion_preferences to authenticated;
grant update(interrupted) on public.companion_messages to authenticated;

-- One transaction: evidence and completion either both commit or neither does.
-- Stable action UUIDs are reused by the existing idempotent mutation receipts.
create function public.confirm_companion_action(p_id uuid,p_mode text,p_message_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.companion_actions; m public.companion_messages; actor uuid:=auth.uid(); r jsonb; s jsonb; approval jsonb;
begin
 if actor is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then raise exception 'COMPANION_FORBIDDEN' using errcode='42501'; end if;
 -- Same lock order as the formal services, also fences deletion/confirmation races.
 perform 1 from public.blueprints where owner_id=actor for update;
 perform 1 from public.companion_conversations where owner_id=actor for update;
 select * into a from public.companion_actions where id=p_id and owner_id=actor for update;
 if not found then raise exception 'COMPANION_NOT_FOUND' using errcode='P0002'; end if;
 if p_mode not in ('click','voice','text') or p_mode is null then raise exception 'COMPANION_INVALID' using errcode='22023'; end if;
 if a.status='applied' then return a.receipt; end if;
 if a.status<>'pending' or a.expires_at<clock_timestamp() then raise exception 'COMPANION_STALE' using errcode='40001'; end if;
 if p_mode<>'click' then
  select * into m from public.companion_messages where id=p_message_id and owner_id=actor and conversation_id=a.conversation_id;
  if not found or m.role<>'user' or m.interrupted or m.created_at<=a.created_at
   or btrim(m.text) !~ '^(确认|确认保存|确认采纳|确认完成|保存|采纳)[。！![:space:]]*$'
   or exists(select 1 from public.companion_messages newer where newer.conversation_id=a.conversation_id and newer.role='user' and newer.created_at>m.created_at)
   or exists(select 1 from public.companion_actions newer where newer.conversation_id=a.conversation_id and newer.kind<>'planning' and newer.status='pending' and newer.expires_at>clock_timestamp() and newer.created_at>a.created_at)
   or exists(select 1 from public.companion_actions consumed where consumed.owner_id=actor and consumed.confirmed_message_id=p_message_id)
   then raise exception 'COMPANION_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
 end if;
 if a.kind='goal' then
  r:=to_jsonb(public.save_goal_brief(a.id,0,a.payload->'content',true,a.id));
 elsif a.kind='progress' then
  r:=to_jsonb(public.record_progress_evidence((a.payload->>'nodeId')::uuid,(a.payload->>'expectedVersion')::bigint,a.payload->>'text',a.payload->>'artifactUrl',a.id));
  if (a.payload->>'completed')::boolean then
   s:=public.confirm_node_status((a.payload->>'nodeId')::uuid,(a.payload->>'expectedVersion')::integer,(a.payload->>'expectedStatusRevision')::integer,'completed',(r->>'id')::uuid,a.id);
  end if;
  r:=jsonb_build_object('evidence',r,'status',s);
 elsif a.kind='plan' then
  approval:=public.read_path_planning_proposal((a.payload->>'runId')::uuid);
  if (approval->'proposal'->>'id')::uuid is distinct from (a.payload->>'proposalId')::uuid then raise exception 'COMPANION_STALE_PLAN' using errcode='40001'; end if;
  perform public.apply_blueprint_proposal((a.payload->>'proposalId')::uuid,(a.payload->>'baseVersion')::bigint,(a.payload->>'proposalId')::uuid);
  r:=public.read_path_planning_proposal((a.payload->>'runId')::uuid);
  if r->'proposal'->>'status'<>'applied' then raise exception 'COMPANION_INVALID_RECEIPT'; end if;
 else raise exception 'COMPANION_NOT_READY' using errcode='22023';
 end if;
 update public.companion_actions set status='applied',receipt=r,confirmed_message_id=case when p_mode='click' then null else p_message_id end where id=a.id;
 return r;
end $$;
revoke all on function public.confirm_companion_action(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_companion_action(uuid,text,uuid) to authenticated;

create function public.cancel_companion_action(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then raise exception 'COMPANION_FORBIDDEN' using errcode='42501'; end if;
 update public.companion_actions set status='cancelled' where id=p_id and owner_id=auth.uid() and status='pending';
end $$;
revoke all on function public.cancel_companion_action(uuid) from public,anon,authenticated;
grant execute on function public.cancel_companion_action(uuid) to authenticated;
