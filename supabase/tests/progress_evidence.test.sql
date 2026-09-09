begin;
select no_plan();

insert into auth.users (id, email) values
  ('a4000000-0000-4000-8000-000000000001', 'evidence-owner@example.test'),
  ('a4000000-0000-4000-8000-000000000002', 'evidence-outsider@example.test');
insert into private.app_config (key, value) values ('extension_oauth_client_id', 'evidence-extension')
on conflict (key) do update set value = excluded.value;
insert into public.goals (id, owner_id, blueprint_id, title, position)
select 'a4000000-0000-4000-8000-000000000010', owner_id, id, '演讲能力', 0
from public.blueprints where owner_id = 'a4000000-0000-4000-8000-000000000001';
insert into public.stages (id, owner_id, goal_id, title, position) values
('a4000000-0000-4000-8000-000000000020', 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000010', '第一周', 0);
insert into public.path_nodes (id, owner_id, stage_id, node_type, title, position) values
('a4000000-0000-4000-8000-000000000030', 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000020', 'practice', '录制三分钟演讲', 0);
insert into public.path_nodes (id, owner_id, stage_id, node_type, title, position)
select id::uuid, 'a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000020', kind::public.path_node_type, title, pos
from (values
  ('a4000000-0000-4000-8000-000000000031', 'learn', '学习表达结构', 1),
  ('a4000000-0000-4000-8000-000000000032', 'checkpoint', '请同学反馈', 2),
  ('a4000000-0000-4000-8000-000000000033', 'reflection', '回顾表达变化', 3)
) as nodes(id, kind, title, pos);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001"}', true);
select results_eq(
  $$select node_title, node_type::text, goal_title, stage_title, blueprint_version, evidence_text, artifact_url
    from public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '完成了首次录制', 'https://example.test/my-talk', 'a4000000-0000-4000-8000-000000000040')$$,
  $$values ('录制三分钟演讲'::text, 'practice'::text, '演讲能力'::text, '第一周'::text, 0::bigint, '完成了首次录制'::text, 'https://example.test/my-talk'::text)$$,
  'a private practice record captures the server-owned path context without a video');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, E'\n\t', null, 'a4000000-0000-4000-8000-000000000041')$$,
  '22023', 'EVIDENCE_INVALID', 'blank lines do not constitute an outcome record');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '修改正文', 'https://example.test/my-talk', 'a4000000-0000-4000-8000-000000000040')$$,
  '22023', 'EVIDENCE_MUTATION_REUSED', 'reusing a mutation ID cannot silently replace evidence');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 1, '成果', null, gen_random_uuid())$$,
  '40001', 'BLUEPRINT_VERSION_CONFLICT', 'a new record requires the displayed Blueprint version');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', null, '成果', null, gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'a NULL version cannot bypass the context check');
select throws_ok(
  $$select public.record_progress_evidence(null, 0, '成果', null, gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'a node identity is required');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, repeat('文', 8001), null, gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'oversized evidence is rejected');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '成果', 'javascript:alert(1)', gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'artifact links must use HTTPS');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '成果', 'https://user:secret@example.test/', gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'credentials cannot be embedded in artifact links');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '成果', E'https://example.test/\nsecret', gen_random_uuid())$$,
  '22023', 'EVIDENCE_INVALID', 'artifact links cannot contain whitespace');
select throws_ok($$insert into public.progress_evidence (owner_id) values (auth.uid())$$,
  '42501', null, 'direct inserts cannot forge context or ownership');
select throws_ok($$update public.progress_evidence set node_title = 'forged'$$,
  '42501', null, 'historical context cannot be edited through the Data API');
select throws_ok($$delete from public.progress_evidence$$,
  '42501', null, 'this append-only slice exposes no direct delete operation');
select results_eq($$select version from public.blueprints$$, $$values (0::bigint)$$,
  'recording evidence does not change the Blueprint version');
select is_empty($$select id from public.blueprint_revisions$$,
  'recording evidence does not manufacture a proposal confirmation');

select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","client_id":"evidence-extension"}', true);
select results_eq(
  $$select node_type::text from public.record_progress_evidence('a4000000-0000-4000-8000-000000000031', 0, '理解了三段结构', null, gen_random_uuid())$$,
  $$values ('learn'::text)$$, 'the configured extension can record learning without a required resource');
select results_eq($$select count(*) from public.progress_evidence$$, $$values (2::bigint)$$,
  'the configured extension reads the same private records as Web');
select results_eq(
  $$select node_type::text from public.record_progress_evidence('a4000000-0000-4000-8000-000000000032', 0, '同学指出了节奏问题', null, gen_random_uuid())$$,
  $$values ('checkpoint'::text)$$, 'checkpoint evidence needs no learning session');
select results_eq(
  $$select node_type::text from public.record_progress_evidence('a4000000-0000-4000-8000-000000000033', 0, '下一次减少口头禅', null, gen_random_uuid())$$,
  $$values ('reflection'::text)$$, 'reflection is also a valid path node for evidence');

select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000002"}', true);
select is_empty($$select id from public.progress_evidence$$, 'another account cannot read the owner evidence');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, 'intrusion', null, gen_random_uuid())$$,
  'P0002', 'PATH_NODE_NOT_FOUND', 'another account cannot attach evidence to an owner node');
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","client_id":"unknown","user_metadata":{"client_id":"evidence-extension"}}', true);
select is_empty($$select id from public.progress_evidence$$, 'unknown OAuth clients cannot read evidence, regardless of user metadata');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, 'intrusion', null, gen_random_uuid())$$,
  '42501', 'EVIDENCE_FORBIDDEN', 'unknown OAuth clients cannot record evidence');
reset role;
delete from private.app_config where key = 'extension_oauth_client_id';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001","client_id":"evidence-extension"}', true);
select is_empty($$select id from public.progress_evidence$$, 'missing configuration fails closed for extension reads');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, 'intrusion', null, gen_random_uuid())$$,
  '42501', 'EVIDENCE_FORBIDDEN', 'missing configuration fails closed for extension writes');
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, 'intrusion', null, gen_random_uuid())$$,
  '42501', 'EVIDENCE_FORBIDDEN', 'a database role without an authenticated identity is insufficient');
reset role;
update public.path_nodes set title = '更新的练习', archived_at = now() where id = 'a4000000-0000-4000-8000-000000000030';
update public.blueprints set version = 1 where owner_id = 'a4000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a4000000-0000-4000-8000-000000000001"}', true);
select results_eq(
  $$select id, node_title, blueprint_version from public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, '完成了首次录制', 'https://example.test/my-talk', 'a4000000-0000-4000-8000-000000000040')$$,
  $$select id, '录制三分钟演讲'::text, 0::bigint from public.progress_evidence where client_mutation_id = 'a4000000-0000-4000-8000-000000000040'$$,
  'retry after a renamed/archived node returns the original receipt and context');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 1, '新记录', null, gen_random_uuid())$$,
  'P0002', 'PATH_NODE_NOT_FOUND', 'an archived node cannot accept new evidence');
select results_eq($$select count(*) from public.progress_evidence$$, $$values (4::bigint)$$,
  'retries and rejected writes do not create additional records');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select id from public.progress_evidence$$, '42501', null, 'anonymous callers cannot read evidence');
select throws_ok(
  $$select public.record_progress_evidence('a4000000-0000-4000-8000-000000000030', 0, 'intrusion', null, gen_random_uuid())$$,
  '42501', null, 'anonymous callers cannot invoke the public write entry point');
reset role;
select * from finish();
rollback;
