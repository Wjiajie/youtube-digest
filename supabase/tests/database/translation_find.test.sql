begin;
select no_plan();
create function pg_temp.tid(n integer) returns uuid language sql as $$select ('ef790000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.request() returns jsonb language sql as $$select jsonb_build_object('bindingId',pg_temp.tid(13),'videoId','abcdefghijk','sourceRunId',pg_temp.tid(20),'offset',0,'targetLanguage','zh-Hans')$$;
insert into auth.users(id,email) values(pg_temp.tid(1),'translation-find-owner@example.test');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select is(public.find_translation_run(pg_temp.request()),'{"run_id":null}'::jsonb,'a valid owner gets only a null identifier when the exact page has no run');
reset role;

insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.tid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.tid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.tid(11),pg_temp.tid(1),pg_temp.tid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.tid(12),pg_temp.tid(1),pg_temp.tid(11),'practice','Practice',0);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
 values(pg_temp.tid(13),pg_temp.tid(1),pg_temp.tid(12),'youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk',0);
insert into private.resource_retention_policies values(pg_temp.tid(1),86400,'local-translation-find-fixture');
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(20),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk","title":"Saved video"},"transcript":{"status":"ready","language":"en","segments":[{"text":"Original fixture text","offset":0,"duration":1000}]}}]}',
 'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1);
insert into private.translation_run_quotas values(pg_temp.tid(1),3);
create function pg_temp.begin_request(n integer) returns jsonb language sql as $$select pg_temp.request()||jsonb_build_object('runId',pg_temp.tid(n))$$;
create function pg_temp.skill() returns jsonb language sql as $$select jsonb_build_object('name','blueprint-translate-transcript','version','1.0.0','instructions','Translate fixture','sha256',encode(sha256(convert_to('Translate fixture','UTF8')),'hex'))$$;
set local role authenticated;
select is(public.begin_translation_run(pg_temp.begin_request(30))->>'status','queued','fixture starts through the caller RPC');
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(30)),'a queued run is discoverable by exact page without storing its ID in the browser');
select is(public.cancel_translation_run(pg_temp.tid(30))->>'status','cancelled','fixture cancels through the caller RPC');
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(30)),'cancelled history is still discoverable');
select is(public.begin_translation_run(pg_temp.begin_request(31))->>'status','queued','a later explicit run is independent');
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(31)),'created_at selects the newest exact-page run');
reset role;
update private.translation_runs set expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.tid(31);
create temporary table before_lookup as select
 (select jsonb_agg(to_jsonb(t) order by id) from private.translation_runs t where owner_id=pg_temp.tid(1)) runs,
 (select jsonb_agg(to_jsonb(q)) from private.translation_run_quotas q where owner_id=pg_temp.tid(1)) quotas,
 (select jsonb_agg(to_jsonb(t) order by id) from public.resource_runs t where owner_id=pg_temp.tid(1)) sources;
set local role authenticated;
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(31)),'find does not hide or reconcile an expired lease');
reset role;
select is((select jsonb_agg(to_jsonb(t) order by id) from private.translation_runs t where owner_id=pg_temp.tid(1)),(select runs from before_lookup),'lookup changes no run bytes including source TTL');
select is((select jsonb_agg(to_jsonb(q)) from private.translation_run_quotas q where owner_id=pg_temp.tid(1)),(select quotas from before_lookup),'lookup neither consumes nor refunds quota');
select is((select jsonb_agg(to_jsonb(t) order by id) from public.resource_runs t where owner_id=pg_temp.tid(1)),(select sources from before_lookup),'lookup preserves original source rows exactly');
set local role authenticated;
select is(public.read_translation_run(pg_temp.tid(31))->>'status','cancelled','separate read still owns lifecycle reconciliation');
select is(public.begin_translation_run(pg_temp.begin_request(32))->>'status','queued','another explicit run can start');
reset role;
set local role service_role;
select is(public.claim_translation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.skill(),'fixture-model')->>'acquired','true','fixture claims only via existing service RPC');
select is(public.finish_translation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),'{"status":"unavailable","providerMayHaveRun":true,"usage":null}')->>'status','failed','fixture persists a safe failure');
reset role;
set local role authenticated;
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(32)),'failed latest run does not fall back to older history');
select is(public.begin_translation_run(pg_temp.begin_request(33))->>'status','queued','ready fixture starts explicitly');
reset role;
set local role service_role;
select is(public.claim_translation_run(pg_temp.tid(1),pg_temp.tid(33),pg_temp.tid(93),pg_temp.skill(),'fixture-model')->>'acquired','true','ready fixture claimed');
select is(public.finish_translation_run(pg_temp.tid(1),pg_temp.tid(33),pg_temp.tid(93),'{"status":"translated","segments":[{"segmentIndex":0,"translation":"夹具译文"}],"providerMayHaveRun":true,"usage":null}')->>'status','ready','ready fixture complete');
reset role;
set local role authenticated;
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(33)),'ready run returns only its ID, never source or translation text');
select is(public.find_translation_run(pg_temp.request()||jsonb_build_object('bindingId',pg_temp.tid(14))),'{"run_id":null}'::jsonb,'binding identity is exact');
select is(public.find_translation_run(pg_temp.request()||'{"videoId":"zyxwvutsrqp"}'),'{"run_id":null}'::jsonb,'video identity is exact');
select is(public.find_translation_run(pg_temp.request()||jsonb_build_object('sourceRunId',pg_temp.tid(21))),'{"run_id":null}'::jsonb,'source run identity is exact');
select is(public.find_translation_run(pg_temp.request()||'{"offset":20}'),'{"run_id":null}'::jsonb,'page offset is exact');
select is(public.find_translation_run(pg_temp.request()||'{"offset":19980}'),'{"run_id":null}'::jsonb,'last valid page offset is accepted');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"targetLanguage":"en"}')$$,'22023','TRANSLATION_INVALID','unsupported target language rejected');
select throws_ok($$select public.find_translation_run(null)$$,'22023','TRANSLATION_INVALID','SQL null rejected');
select throws_ok($$select public.find_translation_run('null')$$,'22023','TRANSLATION_INVALID','JSON null rejected');
select throws_ok($$select public.find_translation_run('[]')$$,'22023','TRANSLATION_INVALID','array rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()-'offset')$$,'22023','TRANSLATION_INVALID','missing field rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||jsonb_build_object('runId',pg_temp.tid(33)))$$,'22023','TRANSLATION_INVALID','caller run ID is not accepted');
select throws_ok($$select public.find_translation_run(pg_temp.request()||jsonb_build_object('accountId',pg_temp.tid(1)))$$,'22023','TRANSLATION_INVALID','caller account is not accepted');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"sourceText":"injected"}')$$,'22023','TRANSLATION_INVALID','source body is not accepted');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"bindingId":"bad"}')$$,'22023','TRANSLATION_INVALID','invalid binding UUID rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"sourceRunId":5}')$$,'22023','TRANSLATION_INVALID','numeric source UUID rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"videoId":"https://youtube.com/watch?v=abcdefghijk"}')$$,'22023','TRANSLATION_INVALID','URL is not a video ID');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"offset":-20}')$$,'22023','TRANSLATION_INVALID','negative offset rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"offset":1}')$$,'22023','TRANSLATION_INVALID','offset must be a multiple of 20');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"offset":0.5}')$$,'22023','TRANSLATION_INVALID','fractional offset rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"offset":"0"}')$$,'22023','TRANSLATION_INVALID','string offset rejected');
select throws_ok($$select public.find_translation_run(pg_temp.request()||'{"offset":20000}')$$,'22023','TRANSLATION_INVALID','offset above source ceiling rejected');
select is(public.clear_resource_evidence(pg_temp.tid(20))->>'status','cleared','existing source clear remains authoritative');
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(33)),'cleared latest receipt remains discoverable without fallback or regeneration');
reset role;

-- Deterministic timestamp ties are fixture data, not mutations of immutable history.
insert into private.translation_runs select (jsonb_populate_record(null::private.translation_runs,to_jsonb(r)||jsonb_build_object('id',pg_temp.tid(n),'created_at',statement_timestamp()))).*
from private.translation_runs r cross join (values(60),(61)) ids(n) where r.id=pg_temp.tid(33);
set local role authenticated;
select is(public.find_translation_run(pg_temp.request()),jsonb_build_object('run_id',pg_temp.tid(61)),'equal creation times are deterministically ordered by descending UUID');
reset role;
insert into auth.users(id,email) values(pg_temp.tid(2),'translation-find-other@example.test');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(2),'role','authenticated')::text,true);
select is(public.find_translation_run(pg_temp.request()),'{"run_id":null}'::jsonb,'another real owner cannot discover the first owner run even with all source IDs');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id','known-extension')::text,true);
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501','TRANSLATION_FORBIDDEN','OAuth client remains forbidden');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id',null)::text,true);
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501','TRANSLATION_FORBIDDEN','present null OAuth client remains forbidden');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','is_anonymous',true)::text,true);
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501','TRANSLATION_FORBIDDEN','anonymous Auth user remains forbidden');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501','TRANSLATION_FORBIDDEN','missing actor remains forbidden');
select throws_ok($$select * from private.translation_runs$$,'42501',null,'discovery never grants direct body access');
reset role;
set local role anon;
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501',null,'anon has no public execute grant');
reset role;
set local role service_role;
select throws_ok($$select public.find_translation_run(pg_temp.request())$$,'42501',null,'service role has no public execute grant');
select throws_ok($$select private.find_translation_run(pg_temp.request())$$,'42501',null,'service role has no private execute grant');
reset role;
select ok((select not prosecdef and provolatile='s' from pg_proc where oid='public.find_translation_run(jsonb)'::regprocedure),'public RPC is a stable invoker');
select ok((select prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid='private.find_translation_run(jsonb)'::regprocedure),'only narrow private lookup is a stable definer with empty search path');
select * from finish();
rollback;
