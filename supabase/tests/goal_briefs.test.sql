begin;
select no_plan();
insert into auth.users(id, email) values
  ('c6000000-0000-4000-8000-000000000001', 'brief-owner@example.test'),
  ('c6000000-0000-4000-8000-000000000002', 'brief-other@example.test');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c6000000-0000-4000-8000-000000000001"}', true);
select is((public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 0,
  '{"schemaVersion":1,"outcome":"","startingPoint":"","targetDate":null,"weeklyMinutes":null,"constraints":"","successCriteria":""}', false,
  'c6000000-0000-4000-8000-000000000020')).status, 'draft', 'incomplete definitions may be saved as private drafts');
select is((select version from public.blueprints), 0::bigint, 'saving a definition does not change the formal Blueprint');
select throws_ok($$select public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 1,
  '{"schemaVersion":1,"outcome":"","startingPoint":"","targetDate":null,"weeklyMinutes":null,"constraints":"","successCriteria":""}', true,
  'c6000000-0000-4000-8000-000000000021')$$, '22023', 'GOAL_BRIEF_INVALID', 'incomplete drafts cannot be confirmed through direct RPC');

create temporary table ready_content as select
  '{"schemaVersion":1,"outcome":"完成一场演讲","startingPoint":"只有课堂经验","targetDate":null,"weeklyMinutes":180,"constraints":"","successCriteria":"获得三位听众的反馈"}'::jsonb as value;
create temporary table confirmation as select * from public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 1,
  (select value from ready_content), true, 'c6000000-0000-4000-8000-000000000021');
select is((select revision from confirmation), 2, 'explicit confirmation creates revision 2');
select is((select status from public.goal_briefs), 'confirmed', 'optional deadline and constraints do not invent missing input or block confirmation');
select is((select content from public.goal_briefs), (select value from ready_content), 'the cloud preserves the reviewed definition verbatim');
select is((public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 2,
  jsonb_set((select value from ready_content), '{outcome}', '"修订后的目标"'), false,
  'c6000000-0000-4000-8000-000000000022')).status, 'draft', 'saving edits invalidates prior confirmation');
select is(to_jsonb(public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 1,
  (select value from ready_content), true, 'c6000000-0000-4000-8000-000000000021')),
  (select to_jsonb(confirmation) from confirmation), 'retry after a later edit returns the exact original confirmation receipt');
select is((select revision from public.goal_briefs), 3, 'retry does not restore an old confirmation or add a revision');
select is((select status from public.goal_briefs), 'draft', 'the latest cloud definition remains unconfirmed after replay');
select throws_ok($$select public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 1,
  jsonb_set((select value from ready_content), '{outcome}', '"different request"'), true,
  'c6000000-0000-4000-8000-000000000021')$$, '22023', 'GOAL_BRIEF_MUTATION_REUSED', 'a mutation ID cannot be reused for different content');
select throws_ok($$select public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 1,
  (select value from ready_content), true, gen_random_uuid())$$, '40001', 'GOAL_BRIEF_VERSION_CONFLICT', 'a stale tab cannot replace a newer definition');

create temporary table invalid_contents as select label,
  case when replacement is null then value - key else jsonb_set(value, array[key], replacement) end as value
from ready_content cross join (values
  ('missing outcome', 'outcome', null::jsonb),
  ('null text', 'startingPoint', 'null'::jsonb),
  ('Unicode whitespace outcome', 'outcome', to_jsonb(U&'\FEFF\2000\00A0'::text)),
  ('missing weekly budget', 'weeklyMinutes', 'null'::jsonb),
  ('fractional weekly budget', 'weeklyMinutes', '1.5'::jsonb),
  ('too large weekly budget', 'weeklyMinutes', '10081'::jsonb),
  ('string weekly budget', 'weeklyMinutes', '"180"'::jsonb),
  ('invalid calendar date', 'targetDate', '"2026-02-30"'::jsonb),
  ('year zero', 'targetDate', '"0000-01-01"'::jsonb),
  ('invalid date type', 'targetDate', '1'::jsonb),
  ('future schema', 'schemaVersion', '2'::jsonb),
  ('unexpected owner override', 'owner_id', '"forged"'::jsonb),
  ('UTF16 oversized outcome', 'outcome', to_jsonb(repeat('😀', 1001)))
) cases(label,key,replacement);
select throws_ok(format('select public.save_goal_brief(%L, 3, %L::jsonb, true, %L)',
  'c6000000-0000-4000-8000-000000000010', value, gen_random_uuid()), '22023', 'GOAL_BRIEF_INVALID', label)
from invalid_contents;
select is((select revision from public.goal_briefs), 3, 'rejected input does not change the current revision');
select is((select count(*) from public.goals), 0::bigint, 'definitions are not silently promoted into formal goals');
select is((select count(*) from public.blueprint_revisions), 0::bigint, 'confirmation of a definition does not confirm a path proposal');
select throws_ok($$update public.goal_briefs set status = 'confirmed'$$, '42501', 'permission denied for table goal_briefs', 'clients cannot bypass the guarded confirmation operation');
select throws_ok($$select * from private.goal_brief_mutations$$, '42501', 'permission denied for table goal_brief_mutations', 'private retry receipts are not a client-readable history API');

select set_config('request.jwt.claims', '{"sub":"c6000000-0000-4000-8000-000000000002"}', true);
select is((select count(*) from public.goal_briefs), 0::bigint, 'a second account cannot read the owner definitions');
select throws_ok($$select public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 3,
  (select value from ready_content), false, gen_random_uuid())$$, 'P0002', 'GOAL_BRIEF_NOT_FOUND', 'a second account cannot edit or confirm the owner definition');
select set_config('request.jwt.claims', '{"sub":"c6000000-0000-4000-8000-000000000001","client_id":"configured-or-unknown"}', true);
select is((select count(*) from public.goal_briefs), 0::bigint, 'OAuth clients cannot read Web planning drafts');
select throws_ok($$select public.save_goal_brief('c6000000-0000-4000-8000-000000000010', 3,
  (select value from ready_content), false, gen_random_uuid())$$, '42501', 'GOAL_BRIEF_FORBIDDEN', 'OAuth cannot save or confirm a definition');
set local role anon;
select throws_ok($$select * from public.goal_briefs$$, '42501', 'permission denied for table goal_briefs', 'anonymous reads are denied');
select throws_ok($$select public.save_goal_brief(null, 0, '{}'::jsonb, false, null)$$,
  '42501', 'permission denied for function save_goal_brief', 'anonymous RPC execution is denied');
reset role;
select is((select count(*) from private.goal_brief_mutations where owner_id = 'c6000000-0000-4000-8000-000000000001'), 3::bigint,
  'only the three accepted mutations have private receipts');
select * from finish();
rollback;
