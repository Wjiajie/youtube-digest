-- AI avatar generation runs: durable, quota-metered, single-flight.
-- Mirrors the resource_runs family (20260910095541) so no new execution semantics are invented.
-- Providers execute outside these short transactions; this migration performs no network work.
create table public.avatar_runs (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('generate')),
 theme_id text not null check(theme_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
 theme_version integer not null check(theme_version > 0),
 status text not null check(status in ('queued','running','ready','failed','cancelled','interrupted','stale')),
 result jsonb,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 check((status in ('queued','running'))=(result is null))
);
create unique index avatar_one_active_owner on public.avatar_runs(owner_id) where status in ('queued','running');
create index avatar_owner_recent on public.avatar_runs(owner_id,created_at desc,id desc);
alter table public.avatar_runs enable row level security;
revoke all on public.avatar_runs from public,anon,authenticated,service_role;
grant select on public.avatar_runs to authenticated;
create policy avatar_web_owner_read on public.avatar_runs for select to authenticated
 using((select auth.uid())=owner_id and not(select private.is_extension_client())
  and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);

create table private.avatar_quotas (
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('generate')),
 available_attempts integer not null check(available_attempts>=0), primary key(owner_id,kind)
);
alter table private.avatar_quotas enable row level security;
revoke all on private.avatar_quotas from public,anon,authenticated,service_role;
grant select,insert,update on private.avatar_quotas to service_role;

create table private.avatar_leases (
 run_id uuid primary key references public.avatar_runs(id) on delete cascade,
 lease_id uuid not null, completion_digest text
);
alter table private.avatar_leases enable row level security;
revoke all on private.avatar_leases from public,anon,authenticated,service_role;

create function private.avatar_web_actor() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or private.is_extension_client() or auth.jwt()->'is_anonymous'='true'::jsonb then
  raise exception 'AVATAR_FORBIDDEN' using errcode='42501';
 end if;
 return auth.uid();
end $$;

-- The owner lock must already be held. Expiration never launches provider work and
-- refunds only a run that never acquired execution.
create function private.avatar_expire_runs(p_owner_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.avatar_runs; pr public.profiles;
begin
 for r in select * from public.avatar_runs where owner_id=p_owner_id and status in ('queued','running')
  and expires_at<=clock_timestamp() order by id for update loop
  update public.avatar_runs set status=case when r.status='queued' then 'cancelled' else 'interrupted' end,
   result=jsonb_build_object('status',case when r.status='queued' then 'cancelled' else 'timed_out' end) where id=r.id;
  if r.status='queued' then update private.avatar_quotas set available_attempts=available_attempts+1 where owner_id=p_owner_id and kind=r.kind; end if;
 end loop;
 select * into pr from public.profiles where id=p_owner_id;
 if not found then return; end if;
 update public.avatar_runs completed set status='stale' where completed.owner_id=p_owner_id and completed.status='ready'
  and (completed.theme_id is distinct from pr.theme_id or completed.theme_version is distinct from pr.theme_version);
end $$;

create function private.avatar_request_valid(v jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare version_text text;
begin
 if jsonb_typeof(v) is distinct from 'object' then return false; end if;
 if octet_length(v::text) > 32768 then return false; end if;
 if not(v ?& array['runId','kind','themeId','themeVersion']) then return false; end if;
 if v - array['runId','kind','themeId','themeVersion'] <> '{}'::jsonb then return false; end if;
 if v->>'kind' is distinct from 'generate' then return false; end if;
 if jsonb_typeof(v->'runId') is distinct from 'string' or (v->>'runId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 if jsonb_typeof(v->'themeId') is distinct from 'string' or v->>'themeId' !~ '^[a-z][a-z0-9_-]{0,63}$' then return false; end if;
 if jsonb_typeof(v->'themeVersion') is distinct from 'number' then return false; end if;
 version_text:=(v->>'themeVersion');
 if version_text !~ '^[0-9]+$' then return false; end if;
 if version_text::bigint < 1 or version_text::bigint > 2147483647 then return false; end if;
 return true;
exception when others then return false;
end $$;

create function private.avatar_result_valid(r public.avatar_runs,v jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare keys text[]; byte_text text;
begin
 if jsonb_typeof(v) is distinct from 'object' then return false; end if;
 if octet_length(v::text) > 4194304 then return false; end if;
 keys:=array(select jsonb_object_keys(v));
 -- Failure receipts are exactly {status} with a §1.3 literal; success has exactly five keys.
 if v->>'status' is distinct from 'generated' then
  if coalesce(array_length(keys,1),0)<>1 then return false; end if;
  if v - 'status' <> '{}'::jsonb then return false; end if;
  if v->>'status' is null or (v->>'status') not in ('invalid_input','not_applicable','unavailable','rate_limited','cancelled','timed_out','not_found','invalid_output') then return false; end if;
  return true;
 end if;
 if coalesce(array_length(keys,1),0)<>5 then return false; end if;
 if v - array['status','objectPath','mimeType','bytes','sha256'] <> '{}'::jsonb then return false; end if;
 if v->>'objectPath' is distinct from r.owner_id::text||'/'||r.id::text||'/avatar.glb' then return false; end if;
 if v->>'mimeType' is distinct from 'model/gltf-binary' then return false; end if;
 if jsonb_typeof(v->'bytes') is distinct from 'number' then return false; end if;
 byte_text:=(v->>'bytes');
 if byte_text !~ '^[0-9]+$' then return false; end if;
 if byte_text::bigint < 1 or byte_text::bigint > 10485760 then return false; end if;
 if jsonb_typeof(v->'sha256') is distinct from 'string' or v->>'sha256' !~ '^[0-9a-f]{64}$' then return false; end if;
 return true;
exception when others then return false;
end $$;

create function private.begin_avatar_run(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; r public.avatar_runs; pr public.profiles; rid uuid;
begin
 actor:=private.avatar_web_actor();
 if not private.avatar_request_valid(p_request) then raise exception 'AVATAR_INVALID' using errcode='22023'; end if;
 rid:=(p_request->>'runId')::uuid;
 perform 1 from public.profiles where id=actor for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 perform private.avatar_expire_runs(actor);
 select * into r from public.avatar_runs where id=rid and owner_id=actor for update;
 if found then
  if r.kind is distinct from p_request->>'kind' or r.theme_id is distinct from p_request->>'themeId'
   or r.theme_version is distinct from (p_request->>'themeVersion')::integer then
   raise exception 'AVATAR_RUN_REUSED' using errcode='22023';
  end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.avatar_runs where id=rid) then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 select * into pr from public.profiles where id=actor;
 if pr.theme_id is distinct from p_request->>'themeId' or pr.theme_version is distinct from (p_request->>'themeVersion')::integer then
  raise exception 'AVATAR_VERSION_CONFLICT' using errcode='40001';
 end if;
 if exists(select 1 from public.avatar_runs where owner_id=actor and status in ('queued','running')) then
  raise exception 'AVATAR_BUSY' using errcode='P0001';
 end if;
 update private.avatar_quotas set available_attempts=available_attempts-1 where owner_id=actor and kind='generate' and available_attempts>0;
 if not found then raise exception 'AVATAR_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 insert into public.avatar_runs(id,owner_id,kind,theme_id,theme_version,status,expires_at)
 values(rid,actor,'generate',p_request->>'themeId',(p_request->>'themeVersion')::integer,'queued',clock_timestamp()+interval '600 seconds')
 returning * into r;
 return to_jsonb(r);
exception when unique_violation then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002';
end $$;

create function private.read_avatar_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.avatar_web_actor(); r public.avatar_runs;
begin
 perform 1 from public.profiles where id=actor for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 perform private.avatar_expire_runs(actor);
 select * into r from public.avatar_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 return to_jsonb(r);
end $$;

create function private.cancel_avatar_run(p_run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.avatar_web_actor(); r public.avatar_runs;
begin
 perform 1 from public.profiles where id=actor for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 perform private.avatar_expire_runs(actor);
 select * into r from public.avatar_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 if r.status='queued' then
  update public.avatar_runs set status='cancelled',result=jsonb_build_object('status','cancelled') where id=r.id returning * into r;
  update private.avatar_quotas set available_attempts=available_attempts+1 where owner_id=actor and kind=r.kind;
 elsif r.status='running' then
  update public.avatar_runs set status='cancelled',result=jsonb_build_object('status','cancelled') where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $$;

create function private.claim_avatar_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.avatar_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'AVATAR_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'AVATAR_INVALID' using errcode='22023'; end if;
 perform 1 from public.profiles where id=p_owner_id for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 perform private.avatar_expire_runs(p_owner_id);
 select * into r from public.avatar_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r)); end if;
 insert into private.avatar_leases(run_id,lease_id) values(r.id,p_lease_id);
 update public.avatar_runs set status='running',expires_at=clock_timestamp()+interval '1800 seconds' where id=r.id returning * into r;
 return jsonb_build_object('acquired',true,'run',to_jsonb(r));
end $$;

create function private.finish_avatar_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.avatar_runs; l private.avatar_leases; pr public.profiles; digest text; terminal text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'AVATAR_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null or p_result is null then raise exception 'AVATAR_INVALID' using errcode='22023'; end if;
 perform 1 from public.profiles where id=p_owner_id for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 perform private.avatar_expire_runs(p_owner_id);
 select * into r from public.avatar_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'AVATAR_NOT_FOUND' using errcode='P0002'; end if;
 select * into l from private.avatar_leases where run_id=r.id;
 if not found or l.lease_id is distinct from p_lease_id then raise exception 'AVATAR_FORBIDDEN' using errcode='42501'; end if;
 digest:=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 if l.completion_digest is not null then
  if l.completion_digest=digest then return to_jsonb(r); end if;
  raise exception 'AVATAR_COMPLETION_REUSED' using errcode='22023';
 end if;
 if r.status in ('cancelled','interrupted') then
  update private.avatar_leases set completion_digest=digest where run_id=r.id;
  return to_jsonb(r);
 end if;
 if r.status<>'running' then raise exception 'AVATAR_INVALID_STATE' using errcode='22023'; end if;
 if not private.avatar_result_valid(r,p_result) then raise exception 'AVATAR_INVALID_RESULT' using errcode='22023'; end if;
 terminal:=case when p_result->>'status'='cancelled' then 'cancelled'
  when p_result->>'status'='generated' then null else 'failed' end;
 select * into pr from public.profiles where id=p_owner_id;
 update public.avatar_runs set status=case
   when terminal is not null then terminal
   when pr.theme_id is distinct from r.theme_id or pr.theme_version is distinct from r.theme_version then 'stale'
   else 'ready' end,
  result=p_result where id=r.id returning * into r;
 update private.avatar_leases set completion_digest=digest where run_id=r.id;
 return to_jsonb(r);
end $$;

revoke all on function private.avatar_web_actor(),private.avatar_expire_runs(uuid),private.avatar_request_valid(jsonb),private.avatar_result_valid(public.avatar_runs,jsonb),
 private.begin_avatar_run(jsonb),private.read_avatar_run(uuid),private.cancel_avatar_run(uuid),
 private.claim_avatar_run(uuid,uuid,uuid),private.finish_avatar_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_avatar_run(jsonb),private.read_avatar_run(uuid),private.cancel_avatar_run(uuid) to authenticated;
grant execute on function private.claim_avatar_run(uuid,uuid,uuid),private.finish_avatar_run(uuid,uuid,uuid,jsonb) to service_role;

create function public.begin_avatar_run(p_request jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.begin_avatar_run(p_request)$$;
create function public.read_avatar_run(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.read_avatar_run(p_run_id)$$;
create function public.cancel_avatar_run(p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.cancel_avatar_run(p_run_id)$$;
create function public.claim_avatar_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.claim_avatar_run(p_owner_id,p_run_id,p_lease_id)$$;
create function public.finish_avatar_run(p_owner_id uuid,p_run_id uuid,p_lease_id uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.finish_avatar_run(p_owner_id,p_run_id,p_lease_id,p_result)$$;
revoke all on function public.begin_avatar_run(jsonb),public.read_avatar_run(uuid),public.cancel_avatar_run(uuid),
 public.claim_avatar_run(uuid,uuid,uuid),public.finish_avatar_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.begin_avatar_run(jsonb),public.read_avatar_run(uuid),public.cancel_avatar_run(uuid) to authenticated;
grant execute on function public.claim_avatar_run(uuid,uuid,uuid),public.finish_avatar_run(uuid,uuid,uuid,jsonb) to service_role;

-- Storage is a Supabase-platform schema that the offline PGlite contract stubs out.
-- Guard the whole block so the migration stays portable; the local stack still gets
-- the bucket and the owner-only read policy.
do $$
begin
 if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then return; end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('avatar-models','avatar-models',false,10485760,array['model/gltf-binary'])
  on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
 if not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='avatar_models_owner_read') then
  create policy avatar_models_owner_read on storage.objects for select to authenticated
   using(bucket_id='avatar-models' and (select auth.uid())::text=split_part(name,'/',1)
    and not(select private.is_extension_client())
    and ((select auth.jwt())->'is_anonymous') is distinct from 'true'::jsonb);
 end if;
end $$;
