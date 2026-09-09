begin;
select no_plan();
insert into auth.users(id,email) values('da000000-0000-4000-8000-000000000001','status-owner@example.test'),('da000000-0000-4000-8000-000000000002','status-other@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select 'da000000-0000-4000-8000-000000000010',owner_id,id,'Goal before',0 from public.blueprints where owner_id='da000000-0000-4000-8000-000000000001';
insert into public.stages(id,owner_id,goal_id,title,position) values('da000000-0000-4000-8000-000000000020','da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000010','Stage before',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values('da000000-0000-4000-8000-000000000030','da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000020','practice','Node before',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position)
select id::uuid,'da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000020',kind::public.path_node_type,kind,pos
from (values ('da000000-0000-4000-8000-000000000031','learn',1),('da000000-0000-4000-8000-000000000032','checkpoint',2),('da000000-0000-4000-8000-000000000033','reflection',3)) n(id,kind,pos);
insert into private.app_config(key,value) values('extension_oauth_client_id','status-extension') on conflict(key) do update set value=excluded.value;
insert into public.goals(id,owner_id,blueprint_id,title,position) select 'da000000-0000-4000-8000-000000000011',owner_id,id,'Other goal',0 from public.blueprints where owner_id='da000000-0000-4000-8000-000000000002';
insert into public.stages(id,owner_id,goal_id,title,position) values('da000000-0000-4000-8000-000000000021','da000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000011','Other stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values('da000000-0000-4000-8000-000000000034','da000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000021','practice','Other node',0);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002"}',true);
select lives_ok($$select public.record_progress_evidence('da000000-0000-4000-8000-000000000034',0,'Other account outcome',null,'da000000-0000-4000-8000-000000000049')$$,'another owner can create their own private evidence');
reset role;
select set_config('status_test.other_evidence',(select id::text from public.progress_evidence where client_mutation_id='da000000-0000-4000-8000-000000000049'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001"}',true);
select is(public.read_node_status_workspace(auth.uid())->'current','[]'::jsonb,'an untouched node has no manufactured status confirmation');
select is(public.read_node_status_workspace(auth.uid())->'history','[]'::jsonb,'initial history is empty');
select lives_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',null,'da000000-0000-4000-8000-000000000040')$$,'a user may self-confirm completion with no criteria or evidence');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',1,1,'in_progress',null,gen_random_uuid())$$,'40001','BLUEPRINT_VERSION_CONFLICT','stale path version cannot change status');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'in_progress',null,gen_random_uuid())$$,'40001','NODE_STATUS_VERSION_CONFLICT','stale node status revision cannot overwrite a confirmation');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,1,'in_progress',null,'da000000-0000-4000-8000-000000000041')->>'revision','2','explicit reopening creates the next status revision');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',null,'da000000-0000-4000-8000-000000000040')->>'revision','1','exact mutation retry returns its original older revision');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'in_progress',null,'da000000-0000-4000-8000-000000000040')$$,'22023','NODE_STATUS_MUTATION_REUSED','changed status cannot reuse a receipt');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,2,'completed',gen_random_uuid(),gen_random_uuid())$$,'22023','NODE_STATUS_EVIDENCE_INVALID','missing evidence cannot be attached to completion');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,2,'completed',
 (select id from public.record_progress_evidence('da000000-0000-4000-8000-000000000030',0,'My result',null,gen_random_uuid())),
 'da000000-0000-4000-8000-000000000042')->>'revision','3','same-owner same-node evidence may accompany completion');
select is(public.read_node_status_workspace(auth.uid())#>>'{current,0,revision}','3','current selects latest revision');
select is(public.read_node_status_workspace(auth.uid())#>>'{history,0,revision}','3','history is newest first');
select is(public.read_node_status_workspace(auth.uid())->'blueprint',public.read_blueprint_snapshot_v2(auth.uid()),'workspace includes the complete current v2 Blueprint');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'completed',
 (select id from public.record_progress_evidence('da000000-0000-4000-8000-000000000031',0,'Other node outcome',null,gen_random_uuid())),gen_random_uuid())$$,
 '22023','NODE_STATUS_EVIDENCE_INVALID','same-owner evidence on another node is rejected');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'completed',current_setting('status_test.other_evidence')::uuid,gen_random_uuid())$$,
 '22023','NODE_STATUS_EVIDENCE_INVALID','evidence from another account is rejected without disclosing its content');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',1,0,'completed',null,'da000000-0000-4000-8000-000000000040')$$,'22023','NODE_STATUS_MUTATION_REUSED','changed expected Blueprint version cannot reuse a receipt');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,1,'completed',null,'da000000-0000-4000-8000-000000000040')$$,'22023','NODE_STATUS_MUTATION_REUSED','changed expected status revision cannot reuse a receipt');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000031',0,0,'completed',null,'da000000-0000-4000-8000-000000000040')$$,'22023','NODE_STATUS_MUTATION_REUSED','changed node identity cannot reuse a receipt');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',gen_random_uuid(),'da000000-0000-4000-8000-000000000040')$$,'22023','NODE_STATUS_MUTATION_REUSED','changed evidence cannot reuse a receipt');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',null,3,'completed',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','missing expected Blueprint version is invalid');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,null,'completed',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','missing expected status revision is invalid');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,-1,'completed',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','negative status revision is invalid');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,2147483647,'completed',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','max expected status revision is rejected before increment overflow');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'mastered',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','automatic mastery is not a supported status');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'in_progress',gen_random_uuid(),gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','evidence is only accepted with completed status');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'completed',null,null)$$,'22023','NODE_STATUS_INVALID','mutation identity is required');
select throws_ok($$insert into public.node_status_confirmations(owner_id) values(auth.uid())$$,'42501',null,'direct inserts cannot forge a confirmation');
select throws_ok($$update public.node_status_confirmations set status='completed'$$,'42501',null,'clients cannot edit history');
select throws_ok($$delete from public.node_status_confirmations$$,'42501',null,'clients cannot delete history');
select throws_ok($$select * from private.node_status_mutations$$,'42501',null,'exact request ledger is not client-readable');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,3,'not_started',null,gen_random_uuid())->>'revision','4','returning to todo is an explicit appended self-assessment');
select is((select count(*) from public.node_status_confirmations),4::bigint,'retries and rejected writes leave no partial confirmations');
select is((select version from public.blueprints),0::bigint,'status confirmations do not mutate the Blueprint version');
select is_empty($$select id from public.blueprint_revisions$$,'status does not manufacture a formal revision');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","client_id":"status-extension"}',true);
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000031',0,0,'in_progress',null,gen_random_uuid())->>'node_type','learn','configured extension may confirm learn without a resource');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000032',0,0,'completed',null,gen_random_uuid())->>'node_type','checkpoint','checkpoint may self-complete without a resource');
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000033',0,0,'completed',null,gen_random_uuid())->>'node_type','reflection','reflection may self-complete without a resource');
select is(jsonb_array_length(public.read_node_status_workspace(auth.uid())->'current'),4,'configured extension reads all active node statuses');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002"}',true);
select is_empty($$select id from public.node_status_confirmations$$,'other accounts cannot read confirmations');
select is(public.read_node_status_workspace('da000000-0000-4000-8000-000000000001'),null::jsonb,'workspace cannot read another owner');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',null,gen_random_uuid())$$,'P0002','PATH_NODE_NOT_FOUND','other accounts cannot confirm an owner node');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","client_id":"unknown","user_metadata":{"client_id":"status-extension"}}',true);
select is_empty($$select id from public.node_status_confirmations$$,'unknown OAuth cannot read private history');
select is(public.read_node_status_workspace(auth.uid()),null::jsonb,'unknown OAuth cannot read workspace');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',null,'da000000-0000-4000-8000-000000000040')$$,'42501','NODE_STATUS_FORBIDDEN','even exact replay rechecks trusted actor');
reset role;
delete from private.app_config where key='extension_oauth_client_id';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","client_id":"status-extension"}',true);
select is(public.read_node_status_workspace(auth.uid()),null::jsonb,'missing OAuth configuration fails closed for workspace');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,4,'completed',null,gen_random_uuid())$$,'42501','NODE_STATUS_FORBIDDEN','missing OAuth configuration fails closed for mutation');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,4,'completed',null,gen_random_uuid())$$,'42501','NODE_STATUS_FORBIDDEN','role without identity is forbidden');
reset role;
update public.path_nodes set title='Node after',estimated_minutes=120,completion_criteria='New criteria',archived_at=now() where id='da000000-0000-4000-8000-000000000030';
update public.goals set title='Goal after' where id='da000000-0000-4000-8000-000000000010';
update public.stages set title='Stage after' where id='da000000-0000-4000-8000-000000000020';
update public.blueprints set version=1 where owner_id='da000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001"}',true);
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000030',0,0,'completed',null,'da000000-0000-4000-8000-000000000040'),
 (select to_jsonb(c) from public.node_status_confirmations c where client_mutation_id='da000000-0000-4000-8000-000000000040'),'exact receipt survives archive, rename and Blueprint version changes');
select results_eq($$select node_title,goal_title,stage_title,estimated_minutes,completion_criteria,blueprint_version from public.node_status_confirmations where client_mutation_id='da000000-0000-4000-8000-000000000040'$$,
 $$values('Node before'::text,'Goal before'::text,'Stage before'::text,null::integer,''::text,0::bigint)$$,'captured path and unknown planning context never drift with later edits');
select is(jsonb_array_length(public.read_node_status_workspace(auth.uid())->'current'),3,'archived node is omitted from current');
select is(jsonb_array_length(public.read_node_status_workspace(auth.uid())->'history'),7,'archived node remains in history');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',1,4,'completed',null,gen_random_uuid())$$,'P0002','PATH_NODE_NOT_FOUND','new confirmation cannot target archived node');
-- Exercise the public RPC repeatedly; the current projection must not inherit the history cap.
do $$begin for rev in 1..52 loop perform public.confirm_node_status('da000000-0000-4000-8000-000000000031',1,rev,'in_progress',null,gen_random_uuid()); end loop; end$$;
select is(jsonb_array_length(public.read_node_status_workspace(auth.uid())->'history'),50,'history is bounded to latest 50');
select is(jsonb_array_length(public.read_node_status_workspace(auth.uid())->'current'),3,'current retains older other-node statuses beyond history page');
select is(public.read_node_status_workspace(auth.uid())#>>'{history,0,revision}','53','latest history returns newest confirmation');
select is(public.read_node_status_workspace(auth.uid())#>>'{history,49,revision}','4','history cutoff is deterministic');
reset role;
-- A local fixture reaches the integer boundary without billions of confirmations.
-- The transition and overflow protection are still exercised via the public RPC.
update public.node_status_confirmations set revision=2147483646 where node_id='da000000-0000-4000-8000-000000000033';
set local role authenticated;
select is(public.confirm_node_status('da000000-0000-4000-8000-000000000033',1,2147483646,'in_progress',null,gen_random_uuid())->>'revision','2147483647','last representable revision is valid without overflow');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000033',1,2147483647,'completed',null,gen_random_uuid())$$,'22023','NODE_STATUS_INVALID','exhausted node revision cannot overflow');
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select id from public.node_status_confirmations$$,'42501',null,'anonymous direct reads denied');
select throws_ok($$select public.read_node_status_workspace('da000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous workspace denied');
select throws_ok($$select public.confirm_node_status('da000000-0000-4000-8000-000000000030',1,4,'completed',null,gen_random_uuid())$$,'42501',null,'anonymous mutation denied');
reset role;
select ok(not prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[], 'workspace is stable invoker with fixed search path') from pg_proc where oid='public.read_node_status_workspace(uuid)'::regprocedure;
select * from finish();
rollback;
