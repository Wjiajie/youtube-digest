-- Reviewed local CLI-generated schema diff; preserve dependency order and explicit ACLs.
-- Working clarification never changes formal Goal Brief data except explicit save.
create function private.clarification_trim(value text) returns text language sql immutable security invoker set search_path='' as $$
 select btrim(value,E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create function private.clarification_text_valid(value text,maximum integer) returns boolean language sql immutable security invoker set search_path='' as $$
 select value is not null and private.clarification_trim(value)<>'' and length(value)+length(regexp_replace(value,U&'[^\+010000-\+10FFFF]','','g'))<=maximum
$$;
create function private.clarification_readiness(value jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare field text; missing jsonb:='[]'; uncertainties jsonb:='[]';
begin
 foreach field in array array['outcome','startingPoint','weeklyMinutes','successCriteria'] loop
  if (field='weeklyMinutes' and value->field='null'::jsonb) or (field<>'weeklyMinutes' and private.clarification_trim(value->>field)='') then missing:=missing||to_jsonb(field); end if;
 end loop;
 if value->'targetDate'='null'::jsonb then uncertainties:=uncertainties||'"targetDate"'::jsonb; end if;
 if private.clarification_trim(value->>'constraints')='' then uncertainties:=uncertainties||'"constraints"'::jsonb; end if;
 return jsonb_build_object('missing',missing,'uncertainties',uncertainties);
end $$;
create table public.goal_clarification_sessions (
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 brief_id uuid not null,blueprint_id uuid not null,brief_revision integer not null check(brief_revision>0),
 input_brief jsonb not null check(jsonb_typeof(input_brief)='object'),content jsonb not null check(private.goal_brief_content_valid(content,false)),
 revision integer not null default 1 check(revision>0),status text not null check(status in ('active','closed','stale')),
 mode text not null check(mode in ('needs_input','reviewable','paused')),question text not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(id,owner_id),foreign key(blueprint_id,owner_id) references public.blueprints(id,owner_id) on delete cascade
);
create unique index clarification_one_session on public.goal_clarification_sessions(owner_id,brief_id) where status='active';
create index clarification_sessions_recent on public.goal_clarification_sessions(owner_id,updated_at desc,id desc);
create index clarification_sessions_blueprint on public.goal_clarification_sessions(blueprint_id,owner_id);
create table public.goal_clarification_turns (
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,session_id uuid not null,
 ordinal integer not null check(ordinal>0),session_revision integer not null check(session_revision>0),
 input_brief jsonb not null,input_content jsonb not null,input_question text not null,input_message text not null,input_history jsonb not null,
 status text not null check(status in ('queued','running','ready','failed','cancelled','interrupted','stale')),
 skill jsonb,result jsonb,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 unique(session_id,ordinal),foreign key(session_id,owner_id) references public.goal_clarification_sessions(id,owner_id) on delete cascade,
 check((status in ('queued','running'))=(result is null)),check(status<>'queued' or skill is null),check(status<>'running' or skill is not null)
);
create unique index clarification_one_turn on public.goal_clarification_turns(owner_id) where status in ('queued','running');
create index clarification_turns_recent on public.goal_clarification_turns(owner_id,created_at desc,id desc);
create index clarification_turns_session_owner on public.goal_clarification_turns(session_id,owner_id);
create table private.goal_clarification_quotas(owner_id uuid primary key references auth.users(id) on delete cascade,available_attempts integer not null check(available_attempts>=0));
create table private.goal_clarification_leases(turn_id uuid primary key references public.goal_clarification_turns(id) on delete cascade,lease_id uuid not null,completion_digest bytea);
create table private.goal_clarification_mutations(owner_id uuid not null references auth.users(id) on delete cascade,operation text not null check(operation in ('edit','save')),
 client_mutation_id uuid not null,request jsonb not null,receipt jsonb not null,primary key(owner_id,operation,client_mutation_id));
alter table public.goal_clarification_sessions enable row level security;
alter table public.goal_clarification_turns enable row level security;
alter table private.goal_clarification_quotas enable row level security;
alter table private.goal_clarification_leases enable row level security;
alter table private.goal_clarification_mutations enable row level security;
revoke all on public.goal_clarification_sessions,public.goal_clarification_turns from public,anon,authenticated,service_role;
grant select on public.goal_clarification_sessions,public.goal_clarification_turns to authenticated;
revoke all on private.goal_clarification_quotas,private.goal_clarification_leases,private.goal_clarification_mutations from public,anon,authenticated,service_role;
grant select,insert,update on private.goal_clarification_quotas to service_role;
create policy clarification_sessions_owner on public.goal_clarification_sessions for select to authenticated using((select auth.uid())=owner_id and not(select private.is_extension_client()) and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);
create policy clarification_turns_owner on public.goal_clarification_turns for select to authenticated using((select auth.uid())=owner_id and not(select private.is_extension_client()) and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);
create function private.clarification_actor() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then raise exception 'CLARIFICATION_FORBIDDEN' using errcode='42501'; end if;
 return auth.uid();
end $$;
create function private.reconcile_clarification(p_owner_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare turn public.goal_clarification_turns; invalid_source boolean;
begin
 update public.goal_clarification_sessions s set status='stale',updated_at=clock_timestamp() where s.owner_id=p_owner_id and s.status='active'
  and not exists(select 1 from public.goal_briefs b where b.id=s.brief_id and b.owner_id=s.owner_id and b.blueprint_id=s.blueprint_id and b.revision=s.brief_revision and b.status='draft');
 for turn in select t.* from public.goal_clarification_turns t join public.goal_clarification_sessions s on s.id=t.session_id
   where t.owner_id=p_owner_id and t.status in ('queued','running') and (s.status<>'active' or t.expires_at<=clock_timestamp()) for update of t loop
  select status<>'active' into invalid_source from public.goal_clarification_sessions where id=turn.session_id;
  update public.goal_clarification_turns set status=case when invalid_source then 'stale' when turn.status='queued' then 'cancelled' else 'interrupted' end,
   result=jsonb_build_object('status',case when invalid_source then 'invalid_input' when turn.status='queued' then 'cancelled' else 'timed_out' end,'providerMayHaveRun',turn.status='running','usage',null) where id=turn.id;
  if turn.status='queued' then update private.goal_clarification_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id; end if;
 end loop;
end $$;
create function private.lock_clarification(p_owner_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.reconcile_clarification(p_owner_id);
end $$;
create function private.create_goal_clarification(p_session_id uuid,p_brief_id uuid,p_expected_brief_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.clarification_actor(); session public.goal_clarification_sessions; brief public.goal_briefs;
begin
 if p_session_id is null or p_brief_id is null or p_expected_brief_revision is null or p_expected_brief_revision<1 then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(actor);
 select * into session from public.goal_clarification_sessions where id=p_session_id and owner_id=actor for update;
 if found then
  if session.brief_id<>p_brief_id or session.brief_revision<>p_expected_brief_revision then raise exception 'CLARIFICATION_REUSED' using errcode='22023'; end if;
  return to_jsonb(session);
 end if;
 if exists(select 1 from public.goal_clarification_sessions where id=p_session_id) then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 select * into brief from public.goal_briefs where id=p_brief_id and owner_id=actor;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 if brief.revision<>p_expected_brief_revision then raise exception 'CLARIFICATION_VERSION_CONFLICT' using errcode='40001'; end if;
 if brief.status<>'draft' then raise exception 'CLARIFICATION_INVALID_STATE' using errcode='22023'; end if;
 if exists(select 1 from public.goal_clarification_sessions where owner_id=actor and brief_id=p_brief_id and status='active') then raise exception 'CLARIFICATION_BUSY' using errcode='P0001'; end if;
 insert into public.goal_clarification_sessions(id,owner_id,brief_id,blueprint_id,brief_revision,input_brief,content,status,mode,question)
 values(p_session_id,actor,brief.id,brief.blueprint_id,brief.revision,jsonb_build_object('id',brief.id,'blueprintId',brief.blueprint_id,'revision',brief.revision,'status',brief.status,'content',brief.content,'updatedAt',brief.updated_at),brief.content,'active','needs_input','你希望实现什么目标？') returning * into session;
 return to_jsonb(session);
exception when unique_violation then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002';
end $$;
create function public.create_goal_clarification(p_session_id uuid,p_brief_id uuid,p_expected_brief_revision integer) returns jsonb language sql security invoker set search_path='' as $$ select private.create_goal_clarification(p_session_id,p_brief_id,p_expected_brief_revision) $$;
revoke all on function private.clarification_trim(text),private.clarification_text_valid(text,integer),private.clarification_readiness(jsonb),private.clarification_actor(),private.reconcile_clarification(uuid),private.lock_clarification(uuid),private.create_goal_clarification(uuid,uuid,integer),public.create_goal_clarification(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.create_goal_clarification(uuid,uuid,integer),public.create_goal_clarification(uuid,uuid,integer) to authenticated;

create function private.read_goal_clarification(p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.clarification_actor(); session public.goal_clarification_sessions;
begin
 if p_session_id is null then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(actor);
 select * into session from public.goal_clarification_sessions where id=p_session_id and owner_id=actor;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 return to_jsonb(session);
end $$;
create function private.begin_goal_clarification(p_turn_id uuid,p_session_id uuid,p_expected_revision integer,p_message text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.clarification_actor(); session public.goal_clarification_sessions; turn public.goal_clarification_turns; history jsonb; next_ordinal integer;
begin
 if p_turn_id is null or p_session_id is null or p_expected_revision is null or p_expected_revision<1 or not private.clarification_text_valid(p_message,8000) then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(actor);
 select * into turn from public.goal_clarification_turns where id=p_turn_id and owner_id=actor for update;
 if found then
  if turn.session_id<>p_session_id or turn.session_revision<>p_expected_revision or turn.input_message<>p_message then raise exception 'CLARIFICATION_REUSED' using errcode='22023'; end if;
  return to_jsonb(turn);
 end if;
 if exists(select 1 from public.goal_clarification_turns where id=p_turn_id) then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 select * into session from public.goal_clarification_sessions where id=p_session_id and owner_id=actor for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 if session.status='stale' or session.revision<>p_expected_revision then raise exception 'CLARIFICATION_VERSION_CONFLICT' using errcode='40001'; end if;
 if session.status<>'active' then raise exception 'CLARIFICATION_INVALID_STATE' using errcode='22023'; end if;
 if exists(select 1 from public.goal_clarification_turns where owner_id=actor and status in ('queued','running')) then raise exception 'CLARIFICATION_BUSY' using errcode='P0001'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('question',input_question,'answer',input_message) order by ordinal),'[]'::jsonb) into history
  from public.goal_clarification_turns where session_id=session.id and status='ready';
 if jsonb_array_length(history)>12 then raise exception 'CLARIFICATION_WINDOW_FULL' using errcode='P0001'; end if;
 update private.goal_clarification_quotas set available_attempts=available_attempts-1 where owner_id=actor and available_attempts>0;
 if not found then raise exception 'CLARIFICATION_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 select coalesce(max(ordinal),0)+1 into next_ordinal from public.goal_clarification_turns where session_id=session.id;
 insert into public.goal_clarification_turns(id,owner_id,session_id,ordinal,session_revision,input_brief,input_content,input_question,input_message,input_history,status,expires_at)
 values(p_turn_id,actor,session.id,next_ordinal,session.revision,session.input_brief,session.content,session.question,p_message,history,'queued',clock_timestamp()+interval '120 seconds') returning * into turn;
 return to_jsonb(turn);
exception when unique_violation then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002';
end $$;
create function private.read_or_cancel_clarification_turn(p_turn_id uuid,p_cancel boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.clarification_actor(); turn public.goal_clarification_turns;
begin
 if p_turn_id is null or p_cancel is null then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(actor);
 select * into turn from public.goal_clarification_turns where id=p_turn_id and owner_id=actor for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 if p_cancel and turn.status in ('queued','running') then
  if turn.status='queued' then update private.goal_clarification_quotas set available_attempts=available_attempts+1 where owner_id=actor; end if;
  update public.goal_clarification_turns set status='cancelled',result=jsonb_build_object('status','cancelled','providerMayHaveRun',turn.status='running','usage',null) where id=turn.id returning * into turn;
 end if;
 return to_jsonb(turn);
end $$;
create function public.read_goal_clarification(p_session_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_goal_clarification(p_session_id) $$;
create function public.begin_goal_clarification(p_turn_id uuid,p_session_id uuid,p_expected_revision integer,p_message text) returns jsonb language sql security invoker set search_path='' as $$ select private.begin_goal_clarification(p_turn_id,p_session_id,p_expected_revision,p_message) $$;
create function public.read_goal_clarification_turn(p_turn_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_or_cancel_clarification_turn(p_turn_id,false) $$;
create function public.cancel_goal_clarification_turn(p_turn_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_or_cancel_clarification_turn(p_turn_id,true) $$;
revoke all on function private.read_goal_clarification(uuid),private.begin_goal_clarification(uuid,uuid,integer,text),private.read_or_cancel_clarification_turn(uuid,boolean),public.read_goal_clarification(uuid),public.begin_goal_clarification(uuid,uuid,integer,text),public.read_goal_clarification_turn(uuid),public.cancel_goal_clarification_turn(uuid) from public,anon,authenticated,service_role;
grant execute on function private.read_goal_clarification(uuid),private.begin_goal_clarification(uuid,uuid,integer,text),private.read_or_cancel_clarification_turn(uuid,boolean),public.read_goal_clarification(uuid),public.begin_goal_clarification(uuid,uuid,integer,text),public.read_goal_clarification_turn(uuid),public.cancel_goal_clarification_turn(uuid) to authenticated;

create function private.mutate_goal_clarification(p_session_id uuid,p_expected_revision integer,p_content jsonb,p_confirm boolean,p_client_mutation_id uuid,p_operation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.clarification_actor(); session public.goal_clarification_sessions; mutation private.goal_clarification_mutations; request jsonb; receipt jsonb; brief public.goal_briefs;
begin
 if p_session_id is null or p_expected_revision is null or p_expected_revision not between 1 and 2147483646 or p_client_mutation_id is null
  or p_operation is null or p_operation not in ('edit','save') or (p_operation='save' and p_confirm is null)
  or (p_operation='edit' and not private.goal_brief_content_valid(p_content,false)) then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(actor);
 request:=jsonb_build_object('sessionId',p_session_id,'expectedRevision',p_expected_revision,'content',p_content,'confirm',p_confirm);
 select * into mutation from private.goal_clarification_mutations where owner_id=actor and operation=p_operation and client_mutation_id=p_client_mutation_id;
 if found then
  if mutation.request<>request then raise exception 'CLARIFICATION_REUSED' using errcode='22023'; end if;
  return mutation.receipt;
 end if;
 select * into session from public.goal_clarification_sessions where id=p_session_id and owner_id=actor for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 if session.status='stale' or session.revision<>p_expected_revision then raise exception 'CLARIFICATION_VERSION_CONFLICT' using errcode='40001'; end if;
 if session.status<>'active' then raise exception 'CLARIFICATION_INVALID_STATE' using errcode='22023'; end if;
 if exists(select 1 from public.goal_clarification_turns where session_id=session.id and status in ('queued','running')) then raise exception 'CLARIFICATION_BUSY' using errcode='P0001'; end if;
 if p_operation='edit' then
  update public.goal_clarification_sessions set content=p_content,mode=case when private.clarification_readiness(p_content)->'missing'='[]'::jsonb then 'reviewable' else 'needs_input' end,
   question='你还想补充或修改哪些信息？',revision=revision+1,updated_at=clock_timestamp() where id=session.id returning * into session;
  receipt:=to_jsonb(session);
 else
  begin
   brief:=private.save_goal_brief(session.brief_id,session.brief_revision,session.content,p_confirm,p_client_mutation_id);
  exception
   when sqlstate '22023' then raise exception 'CLARIFICATION_INVALID' using errcode='22023';
   when sqlstate '40001' then raise exception 'CLARIFICATION_VERSION_CONFLICT' using errcode='40001';
   when sqlstate 'P0002' then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002';
   when sqlstate '42501' then raise exception 'CLARIFICATION_FORBIDDEN' using errcode='42501';
  end;
  update public.goal_clarification_sessions set status='closed',revision=revision+1,updated_at=clock_timestamp() where id=session.id returning * into session;
  receipt:=jsonb_build_object('session',to_jsonb(session),'brief',to_jsonb(brief));
 end if;
 insert into private.goal_clarification_mutations(owner_id,operation,client_mutation_id,request,receipt) values(actor,p_operation,p_client_mutation_id,request,receipt);
 return receipt;
end $$;
create function public.edit_goal_clarification(p_session_id uuid,p_expected_revision integer,p_content jsonb,p_client_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.mutate_goal_clarification(p_session_id,p_expected_revision,p_content,null,p_client_mutation_id,'edit') $$;
create function public.save_goal_clarification(p_session_id uuid,p_expected_revision integer,p_confirm boolean,p_client_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.mutate_goal_clarification(p_session_id,p_expected_revision,null,p_confirm,p_client_mutation_id,'save') $$;
revoke all on function private.mutate_goal_clarification(uuid,integer,jsonb,boolean,uuid,text),public.edit_goal_clarification(uuid,integer,jsonb,uuid),public.save_goal_clarification(uuid,integer,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function private.mutate_goal_clarification(uuid,integer,jsonb,boolean,uuid,text),public.edit_goal_clarification(uuid,integer,jsonb,uuid),public.save_goal_clarification(uuid,integer,boolean,uuid) to authenticated;

create function private.clarification_skill_valid(value jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(value)='object' and value ?& array['name','version','sha256','instructions']
  and value-array['name','version','sha256','instructions']='{}'::jsonb
  and value->>'name'='blueprint-clarify-goal' and jsonb_typeof(value->'version')='string'
  and length(value->>'version')<=64 and value->>'version'~'^[0-9]+\.[0-9]+\.[0-9]+$'
  and jsonb_typeof(value->'sha256')='string' and value->>'sha256'~'^[0-9a-f]{64}$'
  and jsonb_typeof(value->'instructions')='string' and private.clarification_text_valid(value->>'instructions',32000)
  and encode(sha256(convert_to(value->>'instructions','UTF8')),'hex')=value->>'sha256',false)
$$;
create function private.claim_goal_clarification(p_owner_id uuid,p_turn_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare turn public.goal_clarification_turns;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'CLARIFICATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_turn_id is null or p_lease_id is null then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 if not private.clarification_skill_valid(p_skill) then raise exception 'CLARIFICATION_INVALID_SKILL' using errcode='22023'; end if;
 perform private.lock_clarification(p_owner_id);
 select * into turn from public.goal_clarification_turns where id=p_turn_id and owner_id=p_owner_id for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 if turn.status<>'queued' then return jsonb_build_object('acquired',false,'turn',to_jsonb(turn)); end if;
 insert into private.goal_clarification_leases(turn_id,lease_id) values(turn.id,p_lease_id);
 update public.goal_clarification_turns set status='running',skill=p_skill,expires_at=clock_timestamp()+interval '120 seconds' where id=turn.id returning * into turn;
 return jsonb_build_object('acquired',true,'turn',to_jsonb(turn));
end $$;
create function private.clarification_result_valid(value jsonb,turn public.goal_clarification_turns) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare usage jsonb; field text; patch jsonb; seen text[]:='{}'; merged jsonb:=turn.input_content; question jsonb; pause jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' or not(value ?& array['status','providerMayHaveRun','usage'])
  or jsonb_typeof(value->'status') is distinct from 'string' or jsonb_typeof(value->'providerMayHaveRun') is distinct from 'boolean' then return false; end if;
 usage:=value->'usage';
 if usage<>'null'::jsonb then
  if jsonb_typeof(usage)<>'object' or not(usage ?& array['inputTokens','outputTokens','totalTokens']) or usage-array['inputTokens','outputTokens','totalTokens']<>'{}'::jsonb then return false; end if;
  foreach field in array array['inputTokens','outputTokens','totalTokens'] loop
   if usage->field<>'null'::jsonb and (jsonb_typeof(usage->field)<>'number' or (usage->>field)::numeric not between 0 and 9007199254740991 or mod((usage->>field)::numeric,1)<>0) then return false; end if;
  end loop;
 end if;
 if value->>'status' in ('invalid_input','unavailable','invalid_output','cancelled','timed_out') then return value-array['status','providerMayHaveRun','usage']='{}'::jsonb; end if;
 if value->>'status' not in ('needs_input','reviewable','paused') or value->'providerMayHaveRun'<>'true'::jsonb or usage='null'::jsonb
  or not(value ?& array['reflection','changes','question','concerns','pause','content','readiness','skill','source'])
  or value-array['status','providerMayHaveRun','usage','reflection','changes','question','concerns','pause','content','readiness','skill','source']<>'{}'::jsonb
  or jsonb_typeof(value->'reflection')<>'string' or not private.clarification_text_valid(value->>'reflection',1000)
  or not private.goal_brief_content_valid(value->'content',false)
  or value->'skill' is distinct from turn.skill
  or value->'source' is distinct from jsonb_build_object('briefId',turn.input_brief->'id','briefRevision',turn.input_brief->'revision','blueprintId',turn.input_brief->'blueprintId','turnId',turn.id)
  or value->'readiness' is distinct from private.clarification_readiness(value->'content') then return false; end if;
 if jsonb_typeof(value->'changes')<>'array' or jsonb_array_length(value->'changes')>6 then return false; end if;
 for patch in select * from jsonb_array_elements(value->'changes') loop
  if jsonb_typeof(patch)<>'object' or not(patch ?& array['field','value','quote']) or patch-array['field','value','quote']<>'{}'::jsonb then return false; end if;
  field:=patch->>'field';
  if field is null or field not in ('outcome','startingPoint','weeklyMinutes','targetDate','constraints','successCriteria') or field=any(seen)
   or jsonb_typeof(patch->'quote')<>'string' or not private.clarification_text_valid(patch->>'quote',4000) or strpos(turn.input_message,patch->>'quote')=0 then return false; end if;
  seen:=array_append(seen,field); merged:=merged||jsonb_build_object(field,patch->'value');
 end loop;
 if merged is distinct from value->'content' then return false; end if;
 if jsonb_typeof(value->'concerns')<>'array' or jsonb_array_length(value->'concerns')>6 then return false; end if;
 for patch in select * from jsonb_array_elements(value->'concerns') loop
  if jsonb_typeof(patch)<>'string' or not private.clarification_text_valid(patch#>>'{}',500) then return false; end if;
 end loop;
 question:=value->'question'; pause:=value->'pause';
 if question<>'null'::jsonb and (jsonb_typeof(question)<>'object' or not(question ?& array['field','text']) or question-array['field','text']<>'{}'::jsonb
  or jsonb_typeof(question->'field') is distinct from 'string' or question->>'field' not in ('outcome','startingPoint','weeklyMinutes','targetDate','constraints','successCriteria','feasibility')
  or jsonb_typeof(question->'text')<>'string' or not private.clarification_text_valid(question->>'text',1000)) then return false; end if;
 if pause<>'null'::jsonb and (jsonb_typeof(pause)<>'object' or not(pause ? 'quote') or pause-'quote'<>'{}'::jsonb
  or jsonb_typeof(pause->'quote')<>'string' or not private.clarification_text_valid(pause->>'quote',4000) or strpos(turn.input_message,pause->>'quote')=0) then return false; end if;
 return coalesce(case value->>'status'
  when 'needs_input' then question<>'null'::jsonb and pause='null'::jsonb
  when 'paused' then question='null'::jsonb and pause<>'null'::jsonb
  when 'reviewable' then question='null'::jsonb and pause='null'::jsonb and value->'concerns'='[]'::jsonb and value#>'{readiness,missing}'='[]'::jsonb
  else false end,false);
exception when others then return false;
end $$;
create function private.finish_goal_clarification(p_owner_id uuid,p_turn_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare turn public.goal_clarification_turns; session public.goal_clarification_sessions; lease private.goal_clarification_leases; fingerprint bytea; next_status text; stored_result jsonb; next_question text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'CLARIFICATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_turn_id is null or p_lease_id is null or p_result is null then raise exception 'CLARIFICATION_INVALID' using errcode='22023'; end if;
 perform private.lock_clarification(p_owner_id);
 select * into turn from public.goal_clarification_turns where id=p_turn_id and owner_id=p_owner_id for update;
 if not found then raise exception 'CLARIFICATION_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.goal_clarification_leases where turn_id=turn.id for update;
 if not found or lease.lease_id<>p_lease_id then raise exception 'CLARIFICATION_INVALID_STATE' using errcode='22023'; end if;
 fingerprint:=sha256(convert_to(p_result::text,'UTF8'));
 if lease.completion_digest is not null then
  if lease.completion_digest<>fingerprint then raise exception 'CLARIFICATION_COMPLETION_REUSED' using errcode='22023'; end if;
  return to_jsonb(turn);
 end if;
 if not private.clarification_result_valid(p_result,turn) then raise exception 'CLARIFICATION_INVALID_RESULT' using errcode='22023'; end if;
 select * into session from public.goal_clarification_sessions where id=turn.session_id for update;
 stored_result:=p_result;
 if turn.status<>'running' then
  next_status:=turn.status;
  stored_result:=jsonb_build_object('status',case turn.status when 'cancelled' then 'cancelled' when 'interrupted' then 'timed_out' else 'invalid_input' end,'providerMayHaveRun',p_result->'providerMayHaveRun','usage',p_result->'usage');
 elsif session.status<>'active' or session.revision<>turn.session_revision then
  next_status:='stale'; stored_result:=jsonb_build_object('status','invalid_input','providerMayHaveRun',p_result->'providerMayHaveRun','usage',p_result->'usage');
 elsif p_result->>'status' in ('needs_input','reviewable','paused') then
  next_status:='ready'; next_question:=coalesce(p_result#>>'{question,text}','你还想补充或修改哪些信息？');
  if session.content is distinct from p_result->'content' or session.mode is distinct from p_result->>'status' or session.question is distinct from next_question then
   update public.goal_clarification_sessions set content=p_result->'content',mode=p_result->>'status',question=next_question,revision=revision+1,updated_at=clock_timestamp() where id=session.id;
  end if;
 else next_status:=case when p_result->>'status'='cancelled' then 'cancelled' else 'failed' end;
 end if;
 update public.goal_clarification_turns set status=next_status,result=stored_result where id=turn.id returning * into turn;
 update private.goal_clarification_leases set completion_digest=fingerprint where turn_id=turn.id;
 if p_result->'providerMayHaveRun'='false'::jsonb then update private.goal_clarification_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id; end if;
 return to_jsonb(turn);
end $$;
create function public.claim_goal_clarification(p_owner_id uuid,p_turn_id uuid,p_lease_id uuid,p_skill jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.claim_goal_clarification(p_owner_id,p_turn_id,p_lease_id,p_skill) $$;
create function public.finish_goal_clarification(p_owner_id uuid,p_turn_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.finish_goal_clarification(p_owner_id,p_turn_id,p_lease_id,p_result) $$;
revoke all on function private.clarification_skill_valid(jsonb),private.clarification_result_valid(jsonb,public.goal_clarification_turns),private.claim_goal_clarification(uuid,uuid,uuid,jsonb),private.finish_goal_clarification(uuid,uuid,uuid,jsonb),public.claim_goal_clarification(uuid,uuid,uuid,jsonb),public.finish_goal_clarification(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.claim_goal_clarification(uuid,uuid,uuid,jsonb),private.finish_goal_clarification(uuid,uuid,uuid,jsonb),public.claim_goal_clarification(uuid,uuid,uuid,jsonb),public.finish_goal_clarification(uuid,uuid,uuid,jsonb) to service_role;
