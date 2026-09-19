begin;
select no_plan();

-- Preconditions. This file may only run against a real Supabase stack where the
-- storage schema exists; a missing storage schema must fail loudly, never skip.
select ok(to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null,
  'storage schema exists (run via npm run supabase:test, not the offline PGlite contract)');
select ok((select relrowsecurity from pg_class where oid='storage.objects'::regclass),
  'storage.objects has row level security enabled');
select ok(has_table_privilege('authenticated','storage.objects','SELECT'),
  'authenticated holds SELECT on storage.objects so the owner-only read probe is meaningful');

select is((select public from storage.buckets where id='avatar-models'),false,'avatar-models bucket is private');
select is((select file_size_limit from storage.buckets where id='avatar-models'),10485760::bigint,'avatar-models caps a single object at 10 MiB');
select is((select allowed_mime_types from storage.buckets where id='avatar-models'),array['model/gltf-binary']::text[],'avatar-models accepts only GLB');

select is((select count(*)::int from pg_policy where polrelid='storage.objects'::regclass and polname='avatar_models_owner_read'),1,
  'the owner read policy exists exactly once');
select is((select polcmd from pg_policy where polrelid='storage.objects'::regclass and polname='avatar_models_owner_read'),'r',
  'the owner read policy is select-only');
-- storage.objects is platform-owned: assert our policy's presence and the absence of
-- client write policies, not exclusivity of the whole table.
select is((select count(*)::int from pg_policy where polrelid='storage.objects'::regclass
  and polname='avatar_models_owner_read' and polcmd='r'),1,'the avatar owner read policy is present and select-only');
select is((select count(*)::int from pg_policy where polrelid='storage.objects'::regclass
  and polcmd in ('a','w','d')
  and (polroles = array[0::oid] or polroles && array[(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='anon')]::oid[])),
  0,'no anon or authenticated write policy exists on storage.objects');

-- Fixtures: a model object owned by the avatar owner plus a decoy owned by someone else.
insert into auth.users(id,email) values
  ('a2000000-0000-4000-8000-000000000001','storage-owner@example.test'),
  ('a2000000-0000-4000-8000-000000000002','storage-other@example.test');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('avatar-models','avatar-models',false,10485760,array['model/gltf-binary'])
  on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
insert into storage.objects(id,bucket_id,name,owner) values
  ('a2000000-0000-4000-8000-000000000010','avatar-models','a2000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000020/avatar.glb','a2000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000011','avatar-models','a2000000-0000-4000-8000-000000000002/a2000000-0000-4000-8000-000000000021/avatar.glb','a2000000-0000-4000-8000-000000000002');

-- T43: the owner sees exactly its own object; every other caller sees none.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from storage.objects where bucket_id='avatar-models'),1,'owner reads exactly its own object');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from storage.objects where bucket_id='avatar-models' and name like 'a2000000-0000-4000-8000-000000000001/%'),0,'another account cannot read the owner path');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"extension"}',true);
select is((select count(*)::int from storage.objects where bucket_id='avatar-models'),0,'extension client reads no objects');
select set_config('request.jwt.claims','{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from storage.objects where bucket_id='avatar-models'),0,'anonymous session reads no objects');
select throws_ok($$insert into storage.objects(bucket_id,name,owner) values('avatar-models','a2000000-0000-4000-8000-000000000001/a2000000-0000-4000-8000-000000000022/avatar.glb',auth.uid())$$,
  '42501',null,'client cannot insert objects (bucket is server-write only)');
-- With no write policy, UPDATE/DELETE are refused silently rather than raising, so
-- assert the observable effect (zero rows) instead of an error code.
with changed as (update storage.objects set name='a2000000-0000-4000-8000-000000000001/x/avatar.glb' returning 1)
select is((select count(*)::int from changed),0,'a client UPDATE changes no rows because no write policy exists');
with deleted as (delete from storage.objects where name like '%/avatar.glb' returning 1)
select is((select count(*)::int from deleted),0,'a client DELETE changes no rows because no write policy exists');
reset role;
select is((select count(*)::int from storage.objects where bucket_id='avatar-models'),2,'the refused writes left both fixture objects intact');

select * from finish();
rollback;
