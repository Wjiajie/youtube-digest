begin;
select no_plan();
select has_function('public','prepare_path_planning_proposal',array['uuid'],'prepare RPC exists');
insert into auth.users(id,email) values ('fb000000-0000-4000-8000-000000000001','approval-owner@example.test'),('fb000000-0000-4000-8000-000000000002','approval-other@example.test');
insert into public.goal_briefs(id,owner_id,blueprint_id,revision,status,content)
 select 'fb000000-0000-4000-8000-000000000010',owner_id,id,1,'confirmed',
 '{"schemaVersion":1,"outcome":"Learn clearly","startingPoint":"Beginner","targetDate":null,"weeklyMinutes":120,"constraints":"","successCriteria":"Explain a topic"}' from public.blueprints where owner_id='fb000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000001"}',true);
select set_config('approval_test.snapshot',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals}',
 '[{"id":"fb000000-0000-4000-8000-000000000080","title":"New goal","position":0,"stages":[{"id":"fb000000-0000-4000-8000-000000000081","title":"Stage","position":0,"nodes":[{"id":"fb000000-0000-4000-8000-000000000082","type":"learn","title":"Read","position":0,"estimatedMinutes":30,"completionCriteria":"Explain","dependencyIds":[],"resources":[]}]}]}]'::jsonb)::text,true);
reset role;
insert into public.path_planning_runs(id,owner_id,brief_id,blueprint_id,brief_revision,blueprint_version,start_date,status,input_brief,input_blueprint,skill,result,expires_at)
 select ('fb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,b.owner_id,b.id,b.blueprint_id,1,0,current_date,'ready',
 jsonb_build_object('id',b.id,'blueprintId',b.blueprint_id,'revision',1,'status','confirmed','content',b.content,'updatedAt',b.updated_at),
 current_setting('approval_test.snapshot')::jsonb,'{}'::jsonb,
 jsonb_build_object('status','ready','providerMayHaveRun',true,'usage',jsonb_build_object('inputTokens',1,'outputTokens',1,'totalTokens',2),
 'draft',current_setting('approval_test.snapshot')::jsonb,'schedule','[{"nodeId":"fb000000-0000-4000-8000-000000000082","week":1}]'::jsonb,
 'assumptions','[]'::jsonb,'skill','{}'::jsonb,'source','{}'::jsonb),clock_timestamp()+interval '120 seconds'
 from public.goal_briefs b cross join generate_series(20,23) n where b.id='fb000000-0000-4000-8000-000000000010';
update public.path_planning_runs set status='queued',skill=null,result=null where id='fb000000-0000-4000-8000-000000000023';
set local role authenticated;
select throws_ok($$select public.prepare_path_planning_proposal(null)$$,'22023','PATH_PLANNING_INVALID','prepare requires a concrete run identity');
select throws_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000023')$$,'22023','PATH_PLANNING_NOT_READY','uncompleted run cannot produce a proposal');
select is(public.reject_path_planning_proposal('fb000000-0000-4000-8000-000000000023')->'proposal','null'::jsonb,'reject without a proposal is a no-op and never creates one');
select is(public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')->'proposal','null'::jsonb,'read creates no proposal');
select is(public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')->>'ownerId',auth.uid()::text,'receipt binds real owner');
select set_config('approval_test.proposal',(public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')#>>'{proposal,id}'),true);
select is(public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')#>>'{proposal,id}',current_setting('approval_test.proposal'),'prepare exact retry returns one proposal');
select is((select version from public.blueprints where owner_id=auth.uid()),0::bigint,'prepare never edits formal Blueprint');
select is(public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')#>'{proposal,draft}',current_setting('approval_test.snapshot')::jsonb,'proposal uses actual stored draft');
select is_empty($$update public.blueprint_proposals set proposed_snapshot='{}' where id=current_setting('approval_test.proposal')::uuid returning id$$,'linked body cannot be replaced through table UPDATE');
select is_empty($$update public.blueprint_proposals set id=gen_random_uuid(),status='rejected' where id=current_setting('approval_test.proposal')::uuid returning id$$,'linked identity and status cannot be detached through UPDATE');
select throws_ok($$select * from private.path_planning_proposals$$,'42501',null,'mapping is private');
select throws_ok($$select private.apply_blueprint_proposal_core(current_setting('approval_test.proposal')::uuid,0,gen_random_uuid())$$,'42501',null,'old core cannot bypass final source guard');
select lives_ok($$insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select 'fb000000-0000-4000-8000-000000000040',auth.uid(),id,0,current_setting('approval_test.snapshot')::jsonb,'fb000000-0000-4000-8000-000000000040' from public.blueprints where owner_id=auth.uid()$$,'normal manual proposals remain insertable');
select lives_ok($$update public.blueprint_proposals set proposed_snapshot=jsonb_set(proposed_snapshot,'{title}','"Manual edit"') where id='fb000000-0000-4000-8000-000000000040'$$,'unlinked manual proposal updates remain allowed');
select throws_ok($$update public.blueprint_proposals set id=current_setting('approval_test.proposal')::uuid where id='fb000000-0000-4000-8000-000000000040'$$,'42501',null,'WITH CHECK prevents moving a manual row onto a protected link');
select lives_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000021')$$,'another ready run may prepare once');
select is(public.reject_path_planning_proposal('fb000000-0000-4000-8000-000000000021')#>>'{proposal,status}','rejected','pending proposal rejects');
select is(public.reject_path_planning_proposal('fb000000-0000-4000-8000-000000000021')#>>'{proposal,status}','rejected','rejection retries safely');
select is(public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000021')#>>'{proposal,status}','rejected','prepare cannot replace rejected proposal');
reset role;
update public.goal_briefs set revision=2 where id='fb000000-0000-4000-8000-000000000010';
set local role authenticated;
select throws_ok($$select public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,current_setting('approval_test.proposal')::uuid)$$,'40001','PATH_PLANNING_SOURCE_CHANGED','old public confirm entry enforces changed source');
select throws_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000022')$$,'40001','PATH_PLANNING_SOURCE_CHANGED','first preparation rejects stale source');
select is(public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')->'sourceCurrent','false'::jsonb,'existing pending proposal remains recoverable when stale');
reset role;
update public.goal_briefs set revision=1 where id='fb000000-0000-4000-8000-000000000010';
update public.blueprint_proposals set proposed_snapshot=jsonb_set(proposed_snapshot,'{title}','"Untrusted substituted draft"') where id=current_setting('approval_test.proposal')::uuid;
set local role authenticated;
select throws_ok($$select public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,current_setting('approval_test.proposal')::uuid)$$,'23514','PATH_PLANNING_PROPOSAL_INVALID','final guard compares proposal against captured run draft');
reset role;
update public.blueprint_proposals set proposed_snapshot=current_setting('approval_test.snapshot')::jsonb where id=current_setting('approval_test.proposal')::uuid;
set local role authenticated;
select lives_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000022')$$,'prepare competing same-version planning proposal');
select is(public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,current_setting('approval_test.proposal')::uuid),1::bigint,'explicit confirmation applies formal path');
select throws_ok($$select public.apply_blueprint_proposal((public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000022')#>>'{proposal,id}')::uuid,0,gen_random_uuid())$$,'40001','PATH_PLANNING_SOURCE_CHANGED','another formal application makes pending planning source stale');
select is((select estimated_minutes from public.path_nodes where id='fb000000-0000-4000-8000-000000000082'),30,'core preserves latest v2 planning metadata');
select throws_ok($$select public.reject_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'23514','PROPOSAL_NOT_PENDING','applied proposal cannot be rejected');
reset role;
update public.blueprints set version=2 where owner_id='fb000000-0000-4000-8000-000000000001';
update public.goal_briefs set revision=2 where id='fb000000-0000-4000-8000-000000000010';
set local role authenticated;
select is(public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,current_setting('approval_test.proposal')::uuid),1::bigint,'exact success replay returns historical version despite later edits');
select is(public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')#>'{proposal,appliedVersion}','1'::jsonb,'receipt appliedVersion comes from revision, not latest Blueprint');
select is(public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')#>>'{proposal,status}','applied','prepare recovers applied fact despite later source edits');
select throws_ok($$select public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,1,current_setting('approval_test.proposal')::uuid)$$,'40001','BLUEPRINT_VERSION_CONFLICT','changed expected version cannot masquerade as replay');
select throws_ok($$select public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,gen_random_uuid())$$,'23514','PROPOSAL_NOT_PENDING','changed mutation cannot masquerade as replay');
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'P0002','PATH_PLANNING_NOT_FOUND','other owner cannot prepare');
select throws_ok($$select public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'P0002','PATH_PLANNING_NOT_FOUND','other owner cannot read');
select throws_ok($$select public.reject_path_planning_proposal('fb000000-0000-4000-8000-000000000021')$$,'P0002','PATH_PLANNING_NOT_FOUND','other owner cannot reject');
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000001","client_id":"extension"}',true);
select throws_ok($$select public.prepare_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'42501','PATH_PLANNING_FORBIDDEN','extension cannot prepare');
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000001","is_anonymous":true}',true);
select throws_ok($$select public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'42501','PATH_PLANNING_FORBIDDEN','anonymous Auth user cannot read');
select throws_ok($$select public.apply_blueprint_proposal(current_setting('approval_test.proposal')::uuid,0,current_setting('approval_test.proposal')::uuid)$$,'42501','BLUEPRINT_FORBIDDEN','anonymous Auth user cannot confirm');
select is_empty($$select id from public.blueprint_proposals$$,'anonymous Auth direct proposal reads are denied');
reset role;
set local role anon;
select throws_ok($$select public.read_path_planning_proposal('fb000000-0000-4000-8000-000000000020')$$,'42501',null,'anon has no execute grant');
reset role;
select ok(not p.prosecdef and p.proconfig=array['search_path=""']::text[],'public approval wrappers are invoker with empty search_path') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('prepare_path_planning_proposal','read_path_planning_proposal','reject_path_planning_proposal','apply_blueprint_proposal');
select * from finish();
rollback;
