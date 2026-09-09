begin;
select plan(15);
insert into auth.users (id, email) values
  ('b5000000-0000-4000-8000-000000000001', 'snapshot-owner@example.test'),
  ('b5000000-0000-4000-8000-000000000002', 'snapshot-other@example.test');
insert into private.app_config (key, value) values ('extension_oauth_client_id', 'snapshot-extension')
on conflict (key) do update set value = excluded.value;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000001"}', true);
select is(
  public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'),
  (select jsonb_build_object('schemaVersion', 2, 'id', id, 'version', 0, 'title', title, 'goals', '[]'::jsonb) from public.blueprints),
  'the new account reads one complete empty Blueprint snapshot'
);

create temporary table expected_snapshot as
select jsonb_build_object('schemaVersion', 2, 'id', id, 'version', 0, 'title', '真实路径',
  'goals', '[{"id":"b5000000-0000-4000-8000-000000000010","title":"演讲","description":"独立完成演讲","position":0,"stages":[{"id":"b5000000-0000-4000-8000-000000000020","title":"首周","position":0,"nodes":[{"id":"b5000000-0000-4000-8000-000000000030","title":"学习","description":"理解结构","position":0,"type":"learn","estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[{"id":"b5000000-0000-4000-8000-000000000040","kind":"youtube_video","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","externalId":"dQw4w9WgXcQ"}]},{"id":"b5000000-0000-4000-8000-000000000031","title":"练习","position":1,"type":"practice","estimatedMinutes":null,"completionCriteria":"","dependencyIds":["b5000000-0000-4000-8000-000000000030"],"resources":[]},{"id":"b5000000-0000-4000-8000-000000000032","title":"检验","position":2,"type":"checkpoint","estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[]},{"id":"b5000000-0000-4000-8000-000000000033","title":"复盘","position":3,"type":"reflection","estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[]}]}]}]'::jsonb
) as value from public.blueprints;
insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select 'b5000000-0000-4000-8000-000000000050', owner_id, id, 0, (select value from expected_snapshot),
  'b5000000-0000-4000-8000-000000000060' from public.blueprints;
select public.apply_blueprint_proposal('b5000000-0000-4000-8000-000000000050', 0, 'b5000000-0000-4000-8000-000000000070');
update expected_snapshot set value = jsonb_set(value, '{version}', '1');
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), (select value from expected_snapshot),
  'all four node kinds, optional descriptions, ordered children, dependencies and resources survive a confirmed revision');
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000002'), null::jsonb,
  'the owner argument cannot select another user');
select is(public.read_blueprint_snapshot_v2(null), null::jsonb, 'NULL owner never broadens a read');

select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000002"}', true);
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), null::jsonb,
  'another authenticated account cannot read the owner snapshot');
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000002')->'goals', '[]'::jsonb,
  'the second account sees only its own empty path');
select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000001","client_id":"snapshot-extension"}', true);
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), (select value from expected_snapshot),
  'the configured extension reads the same formal snapshot as Web');
select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000001","client_id":"unknown-extension"}', true);
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), null::jsonb,
  'an unknown OAuth client is denied even with the owner sub');
reset role;
delete from private.app_config where key = 'extension_oauth_client_id';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000001","client_id":"snapshot-extension"}', true);
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), null::jsonb,
  'missing configuration fails closed for OAuth');
select set_config('request.jwt.claims', '{"sub":"b5000000-0000-4000-8000-000000000001"}', true);
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), (select value from expected_snapshot),
  'Web still reads its path when extension configuration is absent');

update expected_snapshot set value = jsonb_set(value, '{goals}', '[]');
insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select 'b5000000-0000-4000-8000-000000000051', owner_id, id, 1, (select value from expected_snapshot),
  'b5000000-0000-4000-8000-000000000061' from public.blueprints;
select public.apply_blueprint_proposal('b5000000-0000-4000-8000-000000000051', 1, 'b5000000-0000-4000-8000-000000000071');
update expected_snapshot set value = jsonb_set(value, '{version}', '2');
select is(public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001'), (select value from expected_snapshot),
  'archived goals and descendants do not leak into the new revision');
select is((select count(*) from public.blueprint_revisions), 2::bigint, 'reads never create extra revisions');
select throws_ok($$update public.goals set title = 'bypass'$$, '42501', 'permission denied for table goals',
  'the new read interface does not grant direct formal writes');
set local role anon;
select throws_ok($$select public.read_blueprint_snapshot_v2('b5000000-0000-4000-8000-000000000001')$$,
  '42501', 'permission denied for function read_blueprint_snapshot_v2', 'anonymous RPC execution is denied');
reset role;
select ok((select not prosecdef and provolatile = 's' from pg_proc where oid = 'public.read_blueprint_snapshot_v2(uuid)'::regprocedure),
  'the public read retains caller privileges and a stable statement snapshot');
select * from finish();
rollback;
