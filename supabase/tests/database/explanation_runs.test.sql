begin;
select no_plan();
create function pg_temp.tid(n integer) returns uuid language sql as $$select ('ef830000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.tid(1),'explanation-owner@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.tid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.tid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.tid(11),pg_temp.tid(1),pg_temp.tid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.tid(12),pg_temp.tid(1),pg_temp.tid(11),'practice','Practice',0);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
 values(pg_temp.tid(13),pg_temp.tid(1),pg_temp.tid(12),'youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk',0);
insert into private.resource_retention_policies values(pg_temp.tid(1),86400,'local-explanation-fixture');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(20),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk","title":"Saved video"},"transcript":{"status":"ready","language":"en","segments":[{"text":"  Do not double ISO.  ","offset":1250,"duration":2000},{"text":"Try again.","offset":3250,"duration":1500}]}}]}',
 'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1);
create function pg_temp.req(n integer) returns jsonb language sql as $$select jsonb_build_object('runId',pg_temp.tid(n),'bindingId',pg_temp.tid(13),'videoId','abcdefghijk','sourceRunId',pg_temp.tid(20),'offset',0,'targetLanguage','zh-Hans','selection','{"start":{"segmentIndex":0,"charOffset":2},"end":{"segmentIndex":0,"charOffset":19}}'::jsonb,'question','')$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select throws_ok($$select public.begin_explanation_run(pg_temp.req(30))$$,'P0001','EXPLANATION_QUOTA_EXHAUSTED','explanation cannot consume without configured quota');
reset role;
insert into private.explanation_run_quotas values(pg_temp.tid(1),5);
set local role authenticated;
select is(public.begin_explanation_run(pg_temp.req(30))->>'status','queued','explicit begin queues one durable run');
select is(public.read_explanation_run(pg_temp.tid(30))#>>'{input_page,segments,0,text}','  Do not double ISO.  ','frozen caption comes from server source verbatim');
select is(public.begin_explanation_run(pg_temp.req(30)),public.read_explanation_run(pg_temp.tid(30)),'identical begin is exact receipt recovery');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31))$$,'P0001','EXPLANATION_BUSY','second active run cannot charge quota');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(30)||'{"offset":20}')$$,'22023','EXPLANATION_ID_REUSED','same id cannot change pinned page');
reset role;
create function pg_temp.skill() returns jsonb language sql as $$select jsonb_build_object('name','blueprint-explain-selection','version','1.0.0','instructions','Translate fixture','sha256',encode(extensions.digest('Translate fixture','sha256'),'hex'))$$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(90),pg_temp.skill(),'deepseek-v4-flash')->>'acquired','true','service claims once before model execution');
select is(public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(91),null,null)->>'acquired','false','another lease never reacquires existing run');
create function pg_temp.result() returns jsonb language sql as $$select '{"status":"explained","answer":{"kind":"explanation","meaning":"不要将 ISO 翻倍。","reasoning":"字幕提出了这项限制。","background":null,"checkQuestion":"什么不应翻倍？","limitations":[],"evidence":[{"segmentIndex":0,"quote":"Do not double ISO."}]},"providerMayHaveRun":true,"usage":{"inputTokens":20,"outputTokens":30,"totalTokens":50}}'::jsonb$$;
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(90),pg_temp.result())->>'status','ready','one exact completion becomes durable explained result');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(90),pg_temp.result())->>'status','ready','exact finish retry is idempotent');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(91),pg_temp.result())$$,'42501','EXPLANATION_LEASE_INVALID','wrong lease cannot read or replace completion');
reset role;
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),4,'begin retry and claim replay only charge once');
select throws_ok($$update private.explanation_runs set content_expires_at=content_expires_at+interval '1 day' where id=pg_temp.tid(30)$$,'22023','EXPLANATION_SOURCE_IMMUTABLE','source deadline cannot be extended');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31)||'{"text":"CLIENT_CAPTION"}')$$,'22023','EXPLANATION_INVALID','client cannot provide caption body');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31)||'{"offset":1}')$$,'22023','EXPLANATION_INVALID','non-page boundary invalid');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31)||'{"sourceRunId":null}')$$,'22023','EXPLANATION_INVALID','unpinned source invalid');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31)||'{"targetLanguage":"en"}')$$,'22023','EXPLANATION_INVALID','unapproved target language invalid');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(31)||'{"offset":20}')$$,'P0001','EXPLANATION_NO_EVIDENCE','empty source page cannot create a run');
select is(public.begin_explanation_run(pg_temp.req(31))->>'status','queued','ready prior run does not block new explicit run');
select is(public.cancel_explanation_run(pg_temp.tid(31))#>>'{result,providerMayHaveRun}','false','queued cancellation has no provider uncertainty');
select is(public.cancel_explanation_run(pg_temp.tid(31))->>'status','cancelled','repeat cancellation is stable');
select is(public.begin_explanation_run(pg_temp.req(31))->>'status','cancelled','old cancelled id cannot execute again');
reset role;
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),4,'unclaimed cancellation refunds exactly once');
set local role authenticated;
select is(public.begin_explanation_run(pg_temp.req(32))->>'status','queued','new operation after cancellation');
reset role;
set local role service_role;
select throws_ok($$select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.skill()||'{"sha256":"bad"}','deepseek-v4-flash')$$,'22023','EXPLANATION_INVALID','Skill hash cannot be forged');
select throws_ok($$select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.skill(),'')$$,'22023','EXPLANATION_INVALID','empty model invalid');
select is(public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.skill(),'deepseek-v4-flash')#>>'{run,model}','deepseek-v4-flash','model is pinned on first valid claim');
select ok((public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(93),null,null)->>'observed_at')::timestamptz<=clock_timestamp(),'claim replay has current database observation');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.result()||'{"sourceRunId":"spoof"}')$$,'22023','EXPLANATION_INVALID_RESULT','completion cannot choose source metadata');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),jsonb_set(pg_temp.result(),'{usage,inputTokens}','-1'))$$,'22023','EXPLANATION_INVALID_RESULT','negative usage rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),jsonb_set(pg_temp.result(),'{usage,outputTokens}','0.5'))$$,'22023','EXPLANATION_INVALID_RESULT','fractional usage rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),jsonb_set(pg_temp.result(),'{providerMayHaveRun}','false'))$$,'22023','EXPLANATION_INVALID_RESULT','explained receipt cannot deny model execution');
reset role;
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(32))->>'status','running','invalid completions never alter original run');
select is(public.cancel_explanation_run(pg_temp.tid(32))#>>'{result,providerMayHaveRun}','true','claimed cancellation preserves execution uncertainty');
reset role;
set local role service_role;
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.result())->>'status','cancelled','late valid finish cannot revive cancelled run');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(32),pg_temp.tid(92),pg_temp.result())->>'status','cancelled','late completion exact digest remains recoverable');
reset role;
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),3,'claimed cancellation never refunds');

-- Existing acquisition revision need not equal the current formal Blueprint.
update public.blueprints set version=version+1 where owner_id=pg_temp.tid(1);
update public.resource_runs set status='stale' where id=pg_temp.tid(20);
set local role authenticated;
select is(public.begin_explanation_run(pg_temp.req(33))#>>'{input_page,sourceBlueprintVersion}','0','current practice binding accepts historical source revision');
reset role;
update private.explanation_runs set expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.tid(33);
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(33))->>'status','cancelled','queued operation deadline reconciles on read');
select is(public.read_explanation_run(pg_temp.tid(33))#>>'{result,providerMayHaveRun}','false','queue expiry records no provider execution');
select public.begin_explanation_run(pg_temp.req(34));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(34),pg_temp.tid(94),pg_temp.skill(),'deepseek-v4-flash');
reset role;
update private.explanation_runs set expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.tid(34);
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(34))->>'status','interrupted','running deadline reconciles without revival');
select is(public.read_explanation_run(pg_temp.tid(34))#>>'{result,status}','timed_out','run expiry is a timed out receipt');
reset role;
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),2,'queue expiry refunds once, running expiry never refunds');

-- Private tables and privileged workers never become a client data API.
insert into auth.users(id,email) values(pg_temp.tid(2),'explanation-other@example.test');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(2),'role','authenticated')::text,true);
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'P0002','EXPLANATION_NOT_FOUND','other owner cannot read existing id');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(30))$$,'P0002','EXPLANATION_NOT_FOUND','other owner cannot reuse known id');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id','any-client')::text,true);
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'42501','EXPLANATION_FORBIDDEN','unconfigured OAuth clients denied explanation body');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id',null)::text,true);
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'42501','EXPLANATION_FORBIDDEN','present null client id is not a Web token');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','is_anonymous',true)::text,true);
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'42501','EXPLANATION_FORBIDDEN','anonymous Auth user denied');
select throws_ok($$select * from private.explanation_runs$$,'42501',null,'authenticated direct table read denied');
select throws_ok($$select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(90),pg_temp.skill(),'model')$$,'42501',null,'authenticated cannot claim');
reset role;
set local role service_role;
select throws_ok($$select * from private.explanation_runs$$,'42501',null,'service role cannot select private content table directly');
select throws_ok($$update private.explanation_run_quotas set remaining=999$$,'42501',null,'service role cannot self-grant explanation quota');
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'42501',null,'service role cannot use Web read RPC');
reset role;
set local role anon;
select throws_ok($$select public.read_explanation_run(pg_temp.tid(30))$$,'42501',null,'anon cannot read');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(99))$$,'42501',null,'anon cannot begin');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select public.begin_explanation_run(pg_temp.req(35));
select public.clear_resource_evidence(pg_temp.tid(20));
reset role;
select is((select status from private.explanation_runs where id=pg_temp.tid(30)),'cleared','original chain clearing synchronously clears derivative before another read');
select ok((select input_page is null and selection is null and question is null and skill is null and model is null and result is null from private.explanation_runs where id=pg_temp.tid(30)),'clearing physically removes all derivative bodies');
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),2,'manual clear refunds only queued derivative');
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(30))->>'clear_reason','manual','manual source clearing keeps reason on explained receipt');
select is(public.begin_explanation_run(pg_temp.req(30))->>'status','cleared','same cleared id does not regenerate');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(36))$$,'P0001','EXPLANATION_NO_EVIDENCE','new generation on cleared source denied');
reset role;
set local role service_role;
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(90),'null')->>'status','cleared','cleared late finish returns tombstone before payload parsing');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(30),pg_temp.tid(91),'null')$$,'42501','EXPLANATION_LEASE_INVALID','cleared late finish still validates original lease');
select is(public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(35),pg_temp.tid(95),null,null)->>'acquired','false','cleared queued run cannot be claimed');
reset role;

create function pg_temp.source(n integer) returns void language sql as $$
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(n),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk","title":"Saved video"},"transcript":{"status":"ready","language":"en","segments":[{"text":"  Do not double ISO.  ","offset":0,"duration":1000},{"text":"Again","offset":1000,"duration":1000}]}}]}',
 'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1)
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select pg_temp.source(60);
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(60)||jsonb_build_object('sourceRunId',pg_temp.tid(60)));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(60),pg_temp.tid(96),pg_temp.skill(),'deepseek-v4-flash');
select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(60),pg_temp.tid(96),pg_temp.result());
reset role;
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(61)||jsonb_build_object('sourceRunId',pg_temp.tid(60)));
reset role;
update public.path_nodes set archived_at=clock_timestamp() where id=pg_temp.tid(12);
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(61))->>'clear_reason','source_changed','archived active node clears requested queued run');
reset role;
select is((select status from private.explanation_runs where id=pg_temp.tid(60)),'ready','reconcile does not scan and mutate unrelated completed history');
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),1,'source-changed unclaimed run refunds once');
set local role authenticated;
select is(public.read_explanation_run(pg_temp.tid(60))->>'clear_reason','source_changed','requested old ready result is hidden and erased when archived');
reset role;
update public.path_nodes set archived_at=null where id=pg_temp.tid(12);
update private.explanation_run_quotas set remaining=5 where owner_id=pg_temp.tid(1);
update private.resource_retention_policies set window_seconds=1 where owner_id=pg_temp.tid(1);
select pg_temp.source(70);
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(70)||jsonb_build_object('sourceRunId',pg_temp.tid(70)));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(70),pg_temp.tid(97),pg_temp.skill(),'deepseek-v4-flash');
select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(70),pg_temp.tid(97),pg_temp.result());
reset role;
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(71)||jsonb_build_object('sourceRunId',pg_temp.tid(70)));
reset role;
select pg_sleep(1.05);
set local role authenticated;
select public.read_resource_run(pg_temp.tid(70));
reset role;
select is((select status from private.explanation_runs where id=pg_temp.tid(70)),'cleared','existing original expiry mechanism clears completed explanation without explanation read');
select is((select clear_reason from private.explanation_runs where id=pg_temp.tid(71)),'expired','queued derivative inherits expired clearing reason');
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),4,'expiry refunds queued once and never completed claim');
set local role service_role;
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(70),pg_temp.tid(97),'{}')->>'status','cleared','expired completion cannot revive body or require discarded text');
reset role;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.explanation_runs'::regclass,'private.explanation_run_quotas'::regclass,'private.explanation_run_leases'::regclass)),'all new private tables use RLS defense in depth');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('public.begin_explanation_run(jsonb)'::regprocedure,'public.read_explanation_run(uuid)'::regprocedure,'public.cancel_explanation_run(uuid)'::regprocedure,'public.claim_explanation_run(uuid,uuid,uuid,jsonb,text)'::regprocedure,'public.finish_explanation_run(uuid,uuid,uuid,jsonb)'::regprocedure)),'all public RPC wrappers remain invoker');
-- Empty edge fragments still contribute their limited surrounding context.
update private.resource_retention_policies set window_seconds=86400 where owner_id=pg_temp.tid(1);
update private.explanation_run_quotas set remaining=20 where owner_id=pg_temp.tid(1);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select pg_temp.source(100);
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(100)||jsonb_build_object('sourceRunId',pg_temp.tid(100),'selection','{"start":{"segmentIndex":0,"charOffset":22},"end":{"segmentIndex":1,"charOffset":5}}'::jsonb));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(100),pg_temp.tid(101),pg_temp.skill(),'fixture-model');
create function pg_temp.edge_result() returns jsonb language sql as $$select jsonb_set(pg_temp.result(),'{answer,evidence}','[{"segmentIndex":0,"quote":"Do not double ISO."},{"segmentIndex":1,"quote":"Again"}]')$$;
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(100),pg_temp.tid(101),jsonb_set(pg_temp.edge_result(),'{answer,kind}','null'))$$,'22023','EXPLANATION_INVALID_RESULT','null answer discriminant rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(100),pg_temp.tid(101),jsonb_set(pg_temp.edge_result(),'{status}','null'))$$,'22023','EXPLANATION_INVALID_RESULT','null completion status rejected');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(100),pg_temp.tid(101),pg_temp.edge_result())->>'status','ready','empty first fragment remains context while next segment provides selected evidence');
reset role;
-- Unicode selection and limited-excerpt validation use the caller RPC and service completion seam.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(110),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 jsonb_build_object('status','discovered','candidates',jsonb_build_array(jsonb_build_object('video',jsonb_build_object('videoId','abcdefghijk','title','Unicode source'),'transcript',jsonb_build_object('status','ready','language','en','segments',jsonb_build_array(
 jsonb_build_object('text','A😀B','offset',0,'duration',1000),
 jsonb_build_object('text','  target tail','offset',1000,'duration',1000),
 jsonb_build_object('text',repeat('x',300)||'HIDDEN','offset',2000,'duration',1000),
 jsonb_build_object('text',repeat('😀',1001),'offset',3000,'duration',1000),
 jsonb_build_object('text','fifth','offset',4000,'duration',1000),
 jsonb_build_object('text','sixth','offset',5000,'duration',1000)))))),
 'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1);
create function pg_temp.unicode_req(n integer,sel jsonb) returns jsonb language sql as $$select pg_temp.req(n)||jsonb_build_object('sourceRunId',pg_temp.tid(110),'selection',sel)$$;
set local role authenticated;
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":2},"end":{"segmentIndex":0,"charOffset":3}}'))$$,'22023','EXPLANATION_INVALID','UTF16 start may not split emoji surrogate pair');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":1},"end":{"segmentIndex":0,"charOffset":2}}'))$$,'22023','EXPLANATION_INVALID','UTF16 end may not split emoji surrogate pair');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":1,"charOffset":0},"end":{"segmentIndex":1,"charOffset":2}}'))$$,'22023','EXPLANATION_INVALID','whitespace-only selection cannot reserve quota');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":3,"charOffset":0},"end":{"segmentIndex":3,"charOffset":2002}}'))$$,'22023','EXPLANATION_INVALID','selected text limit counts UTF16 not codepoints');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":0},"end":{"segmentIndex":5,"charOffset":1}}'))$$,'22023','EXPLANATION_INVALID','selection cannot cover six segments');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":0,"text":"spoof"},"end":{"segmentIndex":0,"charOffset":1}}'))$$,'22023','EXPLANATION_INVALID','selection cannot supply arbitrary text');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(111)-'question')$$,'22023','EXPLANATION_INVALID','question field is required');
select throws_ok($$select public.begin_explanation_run(pg_temp.req(111)||jsonb_build_object('question',repeat('😀',501)))$$,'22023','EXPLANATION_INVALID','question UTF16 maximum is 1000');
select is(public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0.0,"charOffset":1.0},"end":{"segmentIndex":0.0,"charOffset":3.0}}')||'{"offset":0.0}')->>'status','queued','integral numeric JSON and complete emoji are a valid selection');
select is(public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":1},"end":{"segmentIndex":0,"charOffset":3}}'))->>'status','queued','same id canonically recovers integer-normalized selection');
select is(public.cancel_explanation_run(pg_temp.tid(111))->>'status','cancelled','emoji attempt is recoverable and cancellable');
select is(public.find_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":1},"end":{"segmentIndex":0,"charOffset":3}}')-'runId')->>'run_id',pg_temp.tid(111)::text,'exact source selection finds its own attempt');
select is(public.find_explanation_run((pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":1},"end":{"segmentIndex":0,"charOffset":3}}')-'runId')||'{"question":"different"}'),'{ "run_id":null }'::jsonb,'different question does not recover unrelated explanation');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(111,'{"start":{"segmentIndex":0,"charOffset":1},"end":{"segmentIndex":0,"charOffset":3}}')||'{"question":"different"}')$$,'22023','EXPLANATION_ID_REUSED','same id cannot change question');
select public.begin_explanation_run(pg_temp.unicode_req(112,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}'));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),pg_temp.skill(),'fixture-model');
create function pg_temp.target_result() returns jsonb language sql as $$select jsonb_set(pg_temp.result(),'{answer,evidence}','[{"segmentIndex":1,"quote":"target"}]')$$;
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,evidence}','[{"segmentIndex":0,"quote":"A😀B"}]'))$$,'22023','EXPLANATION_INVALID_RESULT','context-only quote cannot explain an unquoted selection');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,evidence}','[{"segmentIndex":1,"quote":"target"},{"segmentIndex":2,"quote":"HIDDEN"}]'))$$,'22023','EXPLANATION_INVALID_RESULT','neighbor quotation outside nearest 256 UTF16 is rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,evidence}','[{"segmentIndex":1,"quote":"target"},{"segmentIndex":1,"quote":"target"}]'))$$,'22023','EXPLANATION_INVALID_RESULT','duplicate evidence pair is rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,evidence}','[{"segmentIndex":1,"quote":"TARGET"}]'))$$,'22023','EXPLANATION_INVALID_RESULT','quotation is exact and case-sensitive');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,meaning}',to_jsonb(repeat('😀',1001))))$$,'22023','EXPLANATION_INVALID_RESULT','answer prose obeys UTF16 limit');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,reasoning}',to_jsonb(U&'\00A0\FEFF'::text)))$$,'22023','EXPLANATION_INVALID_RESULT','ECMAScript whitespace-only prose rejected');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),pg_temp.target_result()||'{"requestSha256":"spoof"}')$$,'22023','EXPLANATION_INVALID_RESULT','engine hashes not accepted from service completion');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,kind}','"insufficient_context"'))$$,'22023','EXPLANATION_INVALID_RESULT','answer discriminant must match status');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,extra}','true'))$$,'22023','EXPLANATION_INVALID_RESULT','answer rejects undeclared keys');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),pg_temp.target_result())->>'status','ready','selected exact quote accepts fully validated answer');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),pg_temp.target_result())->>'status','ready','matching completion digest recovers exact answer');
select throws_ok($$select public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(112),pg_temp.tid(113),jsonb_set(pg_temp.target_result(),'{answer,meaning}','"changed"'))$$,'22023','EXPLANATION_COMPLETION_REUSED','different valid answer cannot replace completion');
reset role;
set local role authenticated;
select public.begin_explanation_run(pg_temp.unicode_req(114,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}'));
reset role;
set local role service_role;
select public.claim_explanation_run(pg_temp.tid(1),pg_temp.tid(114),pg_temp.tid(115),pg_temp.skill(),'fixture-model');
select is(public.finish_explanation_run(pg_temp.tid(1),pg_temp.tid(114),pg_temp.tid(115),'{"status":"insufficient_context","providerMayHaveRun":true,"usage":null,"answer":{"kind":"insufficient_context","reason":"无法判断练习上下文。","missingContext":["练习目标"]}}')->>'status','ready','honest insufficient context is a durable ready receipt');
reset role;
set local role authenticated;
select public.clear_resource_evidence(pg_temp.tid(110));
select is(public.find_explanation_run(pg_temp.unicode_req(114,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}')-'runId')->>'run_id',pg_temp.tid(114)::text,'cleared latest attempt remains identity-only discoverable');
select is(public.begin_explanation_run(pg_temp.unicode_req(114,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}'))->>'status','cleared','matching tombstone does not require removed source content');
select throws_ok($$select public.begin_explanation_run(pg_temp.unicode_req(114,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}')||'{"question":"different"}')$$,'22023','EXPLANATION_ID_REUSED','tombstone identity still prevents repurposing old id');
reset role;

-- Exact configured extension identity shares receipts; fixture config is transaction-only.
insert into private.app_config(key,value) values('extension_oauth_client_id','explanation-test-client') on conflict(key) do update set value=excluded.value;
select set_config('explanation.configured_client',(select value from private.app_config where key='extension_oauth_client_id'),true);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id',current_setting('explanation.configured_client'))::text,true);
select is(public.read_explanation_run(pg_temp.tid(112))->>'status','cleared','configured extension can recover Web-created receipt');
select is(public.cancel_explanation_run(pg_temp.tid(112))->>'status','cleared','configured extension cancellation cannot revive tombstone');
select is(public.find_explanation_run(pg_temp.unicode_req(114,'{"start":{"segmentIndex":1,"charOffset":2},"end":{"segmentIndex":1,"charOffset":8}}')-'runId')->>'run_id',pg_temp.tid(114)::text,'configured extension finds same identity');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
reset role;
-- Maintenance erases content without a read_resource/explanation RPC; all effects rollback.
-- Escaped control characters can exceed the model prompt's byte budget below the selection unit limit.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(140),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 jsonb_build_object('status','discovered','candidates',jsonb_build_array(jsonb_build_object('video',jsonb_build_object('videoId','abcdefghijk','title','Escaped source'),'transcript',jsonb_build_object('status','ready','language','en','segments',
 (select jsonb_agg(jsonb_build_object('text',case when i=1 then repeat(chr(1),256)||'A'||repeat(chr(1),143) when i=5 then repeat(chr(1),655) else repeat(chr(1),400) end,'offset',i*1000,'duration',1000) order by i) from generate_series(0,6) i))))),
 'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1);
create function pg_temp.control_req(n integer) returns jsonb language sql as $$select pg_temp.req(n)||jsonb_build_object('sourceRunId',pg_temp.tid(140),'selection','{"start":{"segmentIndex":1,"charOffset":256},"end":{"segmentIndex":5,"charOffset":399}}'::jsonb)$$;
set local role authenticated;
select is(public.begin_explanation_run(pg_temp.control_req(141))->>'status','queued','escaped content fitting the compact prompt budget is permitted');
select public.cancel_explanation_run(pg_temp.tid(141));
select is(public.begin_explanation_run(pg_temp.control_req(143)||jsonb_build_object('question',repeat(chr(1),839)))->>'status','queued','32764-byte compact prompt is accepted without counting structural spaces');
select public.cancel_explanation_run(pg_temp.tid(143));
select throws_ok($$select public.begin_explanation_run(pg_temp.control_req(144)||jsonb_build_object('question',repeat(chr(1),840)))$$,'22023','EXPLANATION_INVALID','32770-byte compact prompt crosses exact 32768-byte budget');
reset role;
select set_config('explanation.before_budget',(select remaining::text from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),true);
set local role authenticated;
select throws_ok($$select public.begin_explanation_run(pg_temp.control_req(142)||jsonb_build_object('question',repeat(chr(1),1000)))$$,'22023','EXPLANATION_INVALID','oversized compact prompt rejected before reserving a run');
reset role;
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),current_setting('explanation.before_budget')::integer,'oversized prompt cannot consume quota or strand recovery');
update private.resource_retention_policies set window_seconds=1 where owner_id=pg_temp.tid(1);
select pg_temp.source(130);
set local role authenticated;
select public.begin_explanation_run(pg_temp.req(130)||jsonb_build_object('sourceRunId',pg_temp.tid(130)));
reset role;
select set_config('explanation.before_sweep',(select remaining::text from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),true);
select pg_sleep(1.05);
select is(private.run_resource_maintenance(1000)->>'status','succeeded','operator maintenance sweeps expired source owner');
select ok((select status='cleared' and clear_reason='expired' and input_page is null and selection is null and question is null and skill is null and model is null and result is null from private.explanation_runs where id=pg_temp.tid(130)),'maintenance physically clears derivative without caller read');
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),current_setting('explanation.before_sweep')::integer+1,'maintenance refunds only unclaimed attempt once');
select private.run_resource_maintenance(1000);
select is((select remaining from private.explanation_run_quotas where owner_id=pg_temp.tid(1)),current_setting('explanation.before_sweep')::integer+1,'repeated maintenance cannot double refund');

select * from finish();
rollback;
