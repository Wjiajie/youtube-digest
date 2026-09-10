begin;
select no_plan();
create function pg_temp.oid(n integer) returns uuid language sql as $$select ('ef660000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.oid(1),'claim-clock-owner@example.test');
insert into private.resource_retention_policies values(pg_temp.oid(1),86400,'local-claim-clock-fixture');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.oid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.oid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.oid(11),pg_temp.oid(1),pg_temp.oid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.oid(12),pg_temp.oid(1),pg_temp.oid(11),'learn','Node',0);
insert into private.resource_quotas values(pg_temp.oid(1),'discover',5);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.oid(1),'role','authenticated')::text,true);
select set_config('claim_clock.request',jsonb_build_object('kind','discover','runId',pg_temp.oid(20),'nodeId',pg_temp.oid(12),'expectedBlueprintVersion',0,
 'preferences',jsonb_build_object('regionCode','US','language','en','allowLanguageFallback',false,'maxDurationSeconds',3600,'publishedAfter',null),
 'learnerContext',jsonb_build_object('startingPoint',null,'constraints',null))::text,true);
select public.begin_resource_run(current_setting('claim_clock.request')::jsonb);
reset role;
set local role service_role;
select set_config('claim_clock.before',clock_timestamp()::text,true);
select set_config('claim_clock.first',public.claim_resource_run(pg_temp.oid(1),pg_temp.oid(20),pg_temp.oid(21),null)::text,true);
select ok((current_setting('claim_clock.first')::jsonb->>'observed_at')::timestamptz between current_setting('claim_clock.before')::timestamptz and clock_timestamp(),'successful run claim reports actual database observation time');
select is(current_setting('claim_clock.first')::jsonb->'acquired','true'::jsonb,'observation does not change first-claim acquisition');
select pg_sleep(.02);
select set_config('claim_clock.replay',public.claim_resource_run(pg_temp.oid(1),pg_temp.oid(20),pg_temp.oid(21),null)::text,true);
select ok((current_setting('claim_clock.replay')::jsonb->>'observed_at')::timestamptz>(current_setting('claim_clock.first')::jsonb->>'observed_at')::timestamptz,'run replay observes new wall time rather than transaction start');
select is(current_setting('claim_clock.replay')::jsonb->'acquired','false'::jsonb,'run replay never reacquires');
select is(current_setting('claim_clock.replay')::jsonb->'run',current_setting('claim_clock.first')::jsonb->'run','run replay does not rewrite row or extend either deadline');
reset role;
set local role authenticated;
select set_config('claim_clock.cleared',public.clear_resource_evidence(pg_temp.oid(20))::text,true);
reset role;
set local role service_role;
select set_config('claim_clock.before',clock_timestamp()::text,true);
select set_config('claim_clock.cleared_reply',public.claim_resource_run(pg_temp.oid(1),pg_temp.oid(20),pg_temp.oid(22),null)::text,true);
select ok((current_setting('claim_clock.cleared_reply')::jsonb->>'observed_at')::timestamptz between current_setting('claim_clock.before')::timestamptz and clock_timestamp(),'cleared run branch also reports server observation');
select is(current_setting('claim_clock.cleared_reply')::jsonb->'run',current_setting('claim_clock.cleared')::jsonb,'observing cleared run cannot restore or alter receipt');
reset role;
-- Saved match fixture; acquisition still uses the real public adoption RPC.
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.oid(30),owner_id,id,version,pg_temp.oid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk"},"eligibleForMatching":true,"transcript":{"status":"ready"}}]}','ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.oid(1);
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.oid(31),owner_id,blueprint_id,blueprint_version,node_id,'match',id,preferences,learner_context,input_blueprint,result,
 '{"status":"matched","assessments":[{"videoId":"abcdefghijk","role":"recommended"}]}','ready',expires_at from public.resource_runs where id=pg_temp.oid(30);
insert into private.resource_adoption_quotas values(pg_temp.oid(1),5);
set local role authenticated;
select public.begin_resource_adoption(jsonb_build_object('adoptionId',pg_temp.oid(40),'sourceRunId',pg_temp.oid(31),'videoId','abcdefghijk','replaceBindingId',null));
reset role;
set local role service_role;
select set_config('claim_clock.before',clock_timestamp()::text,true);
select set_config('claim_clock.adoption',public.claim_resource_adoption(pg_temp.oid(1),pg_temp.oid(40),pg_temp.oid(41))::text,true);
select ok((current_setting('claim_clock.adoption')::jsonb->>'observed_at')::timestamptz between current_setting('claim_clock.before')::timestamptz and clock_timestamp(),'successful adoption claim reports actual database observation');
select is(current_setting('claim_clock.adoption')::jsonb->'acquired','true'::jsonb,'adoption first claim still acquires exactly once');
select pg_sleep(.02);
select set_config('claim_clock.adoption_replay',public.claim_resource_adoption(pg_temp.oid(1),pg_temp.oid(40),pg_temp.oid(41))::text,true);
select ok((current_setting('claim_clock.adoption_replay')::jsonb->>'observed_at')::timestamptz>(current_setting('claim_clock.adoption')::jsonb->>'observed_at')::timestamptz,'adoption replay gets a fresh database observation in the same transaction');
select is(current_setting('claim_clock.adoption_replay')::jsonb->'acquired','false'::jsonb,'adoption replay cannot reacquire');
select is(current_setting('claim_clock.adoption_replay')::jsonb->'adoption',current_setting('claim_clock.adoption')::jsonb->'adoption','adoption replay preserves exact row and inherited source deadline');
reset role;
set local role authenticated;
select public.clear_resource_evidence(pg_temp.oid(30));
select set_config('claim_clock.cleared_adoption',public.read_resource_adoption(pg_temp.oid(40))::text,true);
reset role;
set local role service_role;
select set_config('claim_clock.before',clock_timestamp()::text,true);
select set_config('claim_clock.adoption_cleared_reply',public.claim_resource_adoption(pg_temp.oid(1),pg_temp.oid(40),pg_temp.oid(42))::text,true);
select ok((current_setting('claim_clock.adoption_cleared_reply')::jsonb->>'observed_at')::timestamptz between current_setting('claim_clock.before')::timestamptz and clock_timestamp(),'cleared adoption receipt still observes current database time');
select is(current_setting('claim_clock.adoption_cleared_reply')::jsonb->'acquired','false'::jsonb,'cleared adoption cannot execute again');
select is(current_setting('claim_clock.adoption_cleared_reply')::jsonb->'adoption',current_setting('claim_clock.cleared_adoption')::jsonb,'observation never alters a cleared adoption receipt');
reset role;
select is((select available_attempts from private.resource_quotas where owner_id=pg_temp.oid(1) and kind='discover'),4,'clock observations never refund or consume more resource quota');
select is((select available_attempts from private.resource_adoption_quotas where owner_id=pg_temp.oid(1)),4,'clock observations never refund or consume more adoption quota');
select is((select count(*) from private.resource_leases where run_id=pg_temp.oid(20)),1::bigint,'observations do not create extra run leases');
select is((select count(*) from private.resource_adoption_leases where adoption_id=pg_temp.oid(40)),1::bigint,'observations do not create extra adoption leases');
select ok(has_function_privilege('service_role','public.claim_resource_run(uuid,uuid,uuid,jsonb)','EXECUTE') and has_function_privilege('service_role','public.claim_resource_adoption(uuid,uuid,uuid)','EXECUTE'),'worker public claim permissions preserved');
select ok(not has_function_privilege('authenticated','public.claim_resource_run(uuid,uuid,uuid,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.claim_resource_adoption(uuid,uuid,uuid)','EXECUTE'),'user cannot acquire worker clock or work receipts');
select ok(not has_function_privilege('anon','public.claim_resource_run(uuid,uuid,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.claim_resource_adoption(uuid,uuid,uuid)','EXECUTE'),'anonymous claim denial preserved');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('public.claim_resource_run(uuid,uuid,uuid,jsonb)'::regprocedure,'public.claim_resource_adoption(uuid,uuid,uuid)'::regprocedure)),'public claim wrappers remain invokers');
select * from finish();
rollback;
