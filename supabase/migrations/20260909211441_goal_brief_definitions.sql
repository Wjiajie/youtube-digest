-- Reviewed generated migration: dependency order and explicit ACLs restored.
create function private.goal_brief_content_valid(content jsonb, confirmed boolean)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $$
declare
  field text;
  value text;
  units integer;
  whitespace text := E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if content is null or confirmed is null or jsonb_typeof(content) <> 'object'
    or content->'schemaVersion' is distinct from '1'::jsonb
    or content - array['schemaVersion','outcome','startingPoint','targetDate','weeklyMinutes','constraints','successCriteria'] <> '{}'::jsonb
    or not (content ?& array['outcome','startingPoint','targetDate','weeklyMinutes','constraints','successCriteria']) then return false; end if;
  foreach field in array array['outcome','startingPoint','constraints','successCriteria'] loop
    if jsonb_typeof(content->field) is distinct from 'string' then return false; end if;
    value := content->>field;
    if char_length(value) > (case when field = 'successCriteria' then 4000 else 2000 end) then return false; end if;
    -- Match JavaScript's UTF-16 limits, including supplementary Unicode characters.
    select coalesce(sum(case when ascii(c) > 65535 then 2 else 1 end), 0)::integer into units
      from regexp_split_to_table(value, '') chars(c);
    if units > (case when field = 'successCriteria' then 4000 else 2000 end) then return false; end if;
    if confirmed and field <> 'constraints' and btrim(value, whitespace) = '' then return false; end if;
  end loop;
  if content->'weeklyMinutes' <> 'null'::jsonb then
    if jsonb_typeof(content->'weeklyMinutes') <> 'number' then return false; end if;
    if (content->>'weeklyMinutes')::numeric not between 1 and 10080
      or mod((content->>'weeklyMinutes')::numeric, 1) <> 0 then return false; end if;
  elsif confirmed then return false;
  end if;
  if content->'targetDate' <> 'null'::jsonb then
    if jsonb_typeof(content->'targetDate') <> 'string' then return false; end if;
    value := content->>'targetDate';
    if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(value::date, 'YYYY-MM-DD') <> value then return false; end if;
  end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function private.goal_brief_content_valid(jsonb, boolean) from public, anon, authenticated;

create table public.goal_briefs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  blueprint_id uuid not null,
  revision integer not null check (revision between 1 and 2147483647),
  status text not null check (status in ('draft', 'confirmed')),
  content jsonb not null,
  updated_at timestamptz not null default now(),
  foreign key (blueprint_id, owner_id) references public.blueprints(id, owner_id) on delete cascade,
  check (private.goal_brief_content_valid(content, status = 'confirmed'))
);
create index goal_briefs_owner_recent_idx on public.goal_briefs(owner_id, updated_at desc, id desc);
create index goal_briefs_blueprint_owner_idx on public.goal_briefs(blueprint_id, owner_id);
alter table public.goal_briefs enable row level security;
revoke all on public.goal_briefs from public, anon, authenticated;
grant select on public.goal_briefs to authenticated;
create policy goal_briefs_web_owner_read on public.goal_briefs for select to authenticated
using ((select auth.uid()) = owner_id and not (select private.is_extension_client()));

-- Private immutable receipts preserve exact retries even after later edits.
create table private.goal_brief_mutations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_mutation_id uuid not null,
  request jsonb not null,
  receipt jsonb not null,
  primary key(owner_id, client_mutation_id)
);
alter table private.goal_brief_mutations enable row level security;
revoke all on private.goal_brief_mutations from public, anon, authenticated;

create function private.save_goal_brief(p_id uuid, p_expected_revision integer, p_content jsonb, p_confirm boolean, p_client_mutation_id uuid)
returns public.goal_briefs language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  blueprint uuid;
  current_brief public.goal_briefs;
  receipt private.goal_brief_mutations;
  request jsonb;
begin
  if actor is null or private.is_extension_client() then raise exception 'GOAL_BRIEF_FORBIDDEN' using errcode = '42501'; end if;
  if p_id is null or p_client_mutation_id is null or p_expected_revision is null
    or p_expected_revision not between 0 and 2147483646 or not private.goal_brief_content_valid(p_content, p_confirm) then
    raise exception 'GOAL_BRIEF_INVALID' using errcode = '22023';
  end if;
  select id into blueprint from public.blueprints where owner_id = actor for update;
  if not found then raise exception 'BLUEPRINT_NOT_FOUND' using errcode = 'P0002'; end if;
  request := jsonb_build_object('id', p_id, 'expectedRevision', p_expected_revision, 'content', p_content, 'confirm', p_confirm);
  select * into receipt from private.goal_brief_mutations where owner_id = actor and client_mutation_id = p_client_mutation_id;
  if found then
    if receipt.request <> request then raise exception 'GOAL_BRIEF_MUTATION_REUSED' using errcode = '22023'; end if;
    return jsonb_populate_record(null::public.goal_briefs, receipt.receipt);
  end if;
  select * into current_brief from public.goal_briefs where id = p_id;
  if found then
    if current_brief.owner_id <> actor then raise exception 'GOAL_BRIEF_NOT_FOUND' using errcode = 'P0002'; end if;
    if current_brief.revision <> p_expected_revision then raise exception 'GOAL_BRIEF_VERSION_CONFLICT' using errcode = '40001'; end if;
    update public.goal_briefs set content = p_content, status = case when p_confirm then 'confirmed' else 'draft' end,
      revision = revision + 1, updated_at = now() where id = p_id returning * into current_brief;
  else
    if p_expected_revision <> 0 then raise exception 'GOAL_BRIEF_NOT_FOUND' using errcode = 'P0002'; end if;
    insert into public.goal_briefs(id, owner_id, blueprint_id, revision, status, content)
      values(p_id, actor, blueprint, 1, case when p_confirm then 'confirmed' else 'draft' end, p_content)
      returning * into current_brief;
  end if;
  insert into private.goal_brief_mutations(owner_id, client_mutation_id, request, receipt)
    values(actor, p_client_mutation_id, request, to_jsonb(current_brief));
  return current_brief;
end;
$$;
revoke all on function private.save_goal_brief(uuid, integer, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function private.save_goal_brief(uuid, integer, jsonb, boolean, uuid) to authenticated;
create function public.save_goal_brief(p_id uuid, p_expected_revision integer, p_content jsonb, p_confirm boolean, p_client_mutation_id uuid)
returns public.goal_briefs language sql security invoker set search_path = ''
as $$ select private.save_goal_brief(p_id, p_expected_revision, p_content, p_confirm, p_client_mutation_id) $$;
revoke all on function public.save_goal_brief(uuid, integer, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.save_goal_brief(uuid, integer, jsonb, boolean, uuid) to authenticated;


