begin;
select no_plan();
create function pg_temp.cid(n integer) returns uuid language sql as $$select ('fd560000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.cid(1),'clear-owner@example.test'),(pg_temp.cid(2),'clear-other@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.cid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.cid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.cid(11),pg_temp.cid(1),pg_temp.cid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.cid(12),pg_temp.cid(1),pg_temp.cid(11),'learn','Node',0);
insert into private.resource_quotas values(pg_temp.cid(1),'discover',20),(pg_temp.cid(1),'captions',20),(pg_temp.cid(1),'match',20);
create function pg_temp.discovery(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','discover','runId',pg_temp.cid(n),'nodeId',pg_temp.cid(12),'expectedBlueprintVersion',0,
 'preferences',jsonb_build_object('regionCode','US','language','en','allowLanguageFallback',false,'maxDurationSeconds',3600,'publishedAfter',null),
 'learnerContext',jsonb_build_object('startingPoint','Private source','constraints',null))$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(1),'role','authenticated')::text,true);
select is(public.begin_resource_run(pg_temp.discovery(20))->>'status','queued','reserve a discovery through public RPC');
select lives_ok($$select public.clear_resource_evidence(pg_temp.cid(20))$$,'owner explicitly clears queued chain through public RPC');
reset role;
select is((select available_attempts from private.resource_quotas where owner_id=pg_temp.cid(1) and kind='discover'),20,'clear refunds only unused reservation');
set local role authenticated;
select is(public.begin_resource_run(pg_temp.discovery(20))->>'status','cleared','old discovery id recovers its terminal receipt');
select is(public.begin_resource_run(pg_temp.discovery(30))->>'status','queued','fresh identity reserves independently');
reset role;
set local role service_role;
select is(public.claim_resource_run(pg_temp.cid(1),pg_temp.cid(30),pg_temp.cid(31),null)->'acquired','true'::jsonb,'worker claims before explicit clear');
reset role;
set local role authenticated;
select is(public.clear_resource_evidence(pg_temp.cid(30))->>'status','cleared','owner clears running work');
reset role;
set local role service_role;
select lives_ok($$select public.finish_resource_run(pg_temp.cid(1),pg_temp.cid(30),pg_temp.cid(31),'{}')$$,'valid lease recovers cleared receipt without inspecting erased source or storing result');
reset role;
select is((select available_attempts from private.resource_quotas where owner_id=pg_temp.cid(1) and kind='discover'),19,'running clear never refunds');
-- Durable source fixture: public adoption/clear RPCs exercise this saved three-step chain.
create function pg_temp.seed_chain(n integer) returns void language plpgsql as $$begin
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.cid(n),owner_id,id,version,pg_temp.cid(12),'discover',pg_temp.discovery(20)->'preferences',pg_temp.discovery(20)->'learnerContext',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk","title":"Private video metadata"},"eligibleForMatching":true,"transcript":{"status":"ready","segments":[{"text":"Private transcript"}]}}]}','ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.cid(1);
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.cid(n+1),owner_id,blueprint_id,blueprint_version,node_id,'captions',id,preferences,learner_context,input_blueprint,result,result,'ready',expires_at from public.resource_runs where id=pg_temp.cid(n);
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.cid(n+2),owner_id,blueprint_id,blueprint_version,node_id,'match',id,preferences,learner_context,input_blueprint,result,
 '{"status":"matched","summary":"Private interpretation","assessments":[{"videoId":"abcdefghijk","role":"recommended"}]}','ready',expires_at from public.resource_runs where id=pg_temp.cid(n+1);
end $$;
create function pg_temp.adopt(n integer,s integer) returns jsonb language sql as $$select jsonb_build_object('adoptionId',pg_temp.cid(n),'sourceRunId',pg_temp.cid(s),'videoId','abcdefghijk','replaceBindingId',null)$$;
select pg_temp.seed_chain(100);
insert into private.resource_adoption_quotas values(pg_temp.cid(1),20);
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(200,102))->>'status','queued','adoption reserved from matched source');
reset role;
set local role service_role;
select is(public.claim_resource_adoption(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201))->'acquired','true'::jsonb,'adoption claimed');
select set_config('clear.verified','{"status":"verified","video":{"videoId":"abcdefghijk","title":"Private verified title","channelTitle":"Private channel","publishedAt":"2026-01-01T00:00:00Z","durationSeconds":900}}',true);
select set_config('clear.ready',public.finish_resource_adoption(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201),current_setting('clear.verified')::jsonb)::text,true);
reset role;
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(210,102))->>'status','queued','second pending verification remains unused');
select set_config('clear.receipt',public.clear_resource_evidence(pg_temp.cid(101))::text,true);
select is(current_setting('clear.receipt')::jsonb->>'id',pg_temp.cid(101)::text,'clear returns requested descendant receipt');
select is(public.read_resource_run(pg_temp.cid(100))->>'status','cleared','ancestor cleared');
select is(public.read_resource_run(pg_temp.cid(102))->>'status','cleared','descendant cleared');
select is(public.read_resource_adoption(pg_temp.cid(200))->>'status','cleared','ready verification cleared');
select is(public.read_resource_adoption(pg_temp.cid(210))->>'status','cleared','queued verification cleared');
select is(public.clear_resource_evidence(pg_temp.cid(101)),current_setting('clear.receipt')::jsonb,'repeat clear returns byte-equivalent JSON receipt');
reset role;
select is((select available_attempts from private.resource_adoption_quotas where owner_id=pg_temp.cid(1)),19,'only queued adoption refunded once');
select is((select status from public.blueprint_proposals where id=(current_setting('clear.ready')::jsonb->>'proposal_id')::uuid),'rejected','pending adoption proposal rejected');
select is((select count(*) from public.resource_runs where id in (pg_temp.cid(100),pg_temp.cid(101),pg_temp.cid(102)) and cleared_at is not null and preferences is null and learner_context is null and input_blueprint is null and input_discovery is null and skill is null and result is null),3::bigint,'all resource evidence copies actually erased');
set local role service_role;
select lives_ok($$select public.claim_resource_run(pg_temp.cid(1),pg_temp.cid(102),pg_temp.cid(999),null)$$,'cleared match claim needs no erased Skill');
select lives_ok($$select public.finish_resource_adoption(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(201),'{}')$$,'cleared adoption finish validates lease but never erased video or payload');
select is(public.claim_resource_run(pg_temp.cid(1),pg_temp.cid(102),pg_temp.cid(999),null)->'acquired','false'::jsonb,'cleared match never reacquires provider work');
select is(public.claim_resource_adoption(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(999))->'acquired','false'::jsonb,'cleared adoption never reacquires verification');
select throws_ok($$select public.finish_resource_adoption(pg_temp.cid(1),pg_temp.cid(200),pg_temp.cid(999),'{}')$$,'42501','RESOURCE_ADOPTION_FORBIDDEN','clear does not relax lease authentication');
select throws_ok($$select public.finish_resource_run(pg_temp.cid(1),pg_temp.cid(30),pg_temp.cid(999),'{}')$$,'42501','RESOURCE_FORBIDDEN','cleared resource still authenticates original lease');
reset role;
select is((select count(*) from public.resource_adoptions where id in (pg_temp.cid(200),pg_temp.cid(210)) and video_id is null and result is null and cleared_at is not null),2::bigint,'adoption payloads erased, receipts retained');
select ok((select verified_at is not null and valid_until is not null and proposal_id is not null from public.resource_adoptions where id=pg_temp.cid(200)),'verification and proposal identity retained');
select is((select completion_digest from private.resource_adoption_leases where adoption_id=pg_temp.cid(200)),sha256(convert_to(current_setting('clear.verified')::jsonb::text,'UTF8')),'completed verification digest unchanged after late malformed finish');
select ok((select completion_digest is null from private.resource_leases where run_id=pg_temp.cid(30)),'late cleared finish stores no new payload digest');
select is((select count(distinct cleared_at) from public.resource_runs where id in (pg_temp.cid(100),pg_temp.cid(101),pg_temp.cid(102))),1::bigint,'one clear operation has one chain timestamp');
select throws_ok($$update public.resource_runs set result='{}' where id=pg_temp.cid(100)$$,'23514',null,'database invariant forbids payload on a cleared resource even for maintenance code');
select throws_ok($$update public.resource_adoptions set video_id='abcdefghijk' where id=pg_temp.cid(200)$$,'23514',null,'database invariant forbids video on a cleared adoption');
select throws_ok($$update public.resource_runs set status='ready' where id=pg_temp.cid(100)$$,'23514',null,'cleared receipt cannot be relabeled with missing evidence');
select is((select count(*) from private.resource_leases where run_id=pg_temp.cid(102)),0::bigint,'claiming cleared match creates no lease');
set local role authenticated;
select is(public.begin_resource_run(jsonb_set(pg_temp.discovery(20),'{preferences,language}','"zh"'))->>'status','cleared','erased preferences are not required for terminal recovery');
select throws_ok($$select public.begin_resource_run(pg_temp.discovery(20)||jsonb_build_object('nodeId',pg_temp.cid(999)))$$,'22023','RESOURCE_RUN_REUSED','retained node still prevents old-id reuse');
select throws_ok($$select public.begin_resource_run(pg_temp.discovery(20)||'{"expectedBlueprintVersion":1}')$$,'22023','RESOURCE_RUN_REUSED','retained Blueprint version still checked');
select is(public.begin_resource_run(jsonb_build_object('kind','match','runId',pg_temp.cid(102),'sourceRunId',pg_temp.cid(101)))->>'status','cleared','old descendant recovers without erased evidence');
select throws_ok($$select public.begin_resource_run(jsonb_build_object('kind','match','runId',pg_temp.cid(102),'sourceRunId',pg_temp.cid(100)))$$,'22023','RESOURCE_RUN_REUSED','retained parent identity still checked');
select throws_ok($$select public.begin_resource_run(jsonb_build_object('kind','captions','runId',pg_temp.cid(105),'sourceRunId',pg_temp.cid(100)))$$,'22023','RESOURCE_INVALID_STATE','no new child of cleared evidence');
select is(public.begin_resource_adoption(pg_temp.adopt(200,102)||'{"videoId":"lmnopqrstuv"}')->>'status','cleared','erased video is not required to recover terminal adoption');
select throws_ok($$select public.begin_resource_adoption(pg_temp.adopt(200,102)||jsonb_build_object('replaceBindingId',pg_temp.cid(999)))$$,'22023','RESOURCE_ADOPTION_RUN_REUSED','replacement identity remains immutable');
select throws_ok($$select public.begin_resource_adoption(pg_temp.adopt(211,102))$$,'40001','RESOURCE_ADOPTION_SOURCE_CHANGED','cleared evidence cannot create a new adoption');
select throws_ok($$select public.apply_blueprint_proposal((current_setting('clear.ready')::jsonb->>'proposal_id')::uuid,0,pg_temp.cid(250))$$,'23514','PROPOSAL_NOT_PENDING','cleared pending proposal cannot be applied');
select is(public.cancel_resource_run(pg_temp.cid(101)),current_setting('clear.receipt')::jsonb,'cancel cannot restore a cleared receipt');
select throws_ok($$update public.resource_runs set result='{}' where id=pg_temp.cid(100)$$,'42501',null,'user cannot directly restore payload');
select throws_ok($$update public.resource_adoptions set video_id='abcdefghijk' where id=pg_temp.cid(200)$$,'42501',null,'user cannot directly restore verified video');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(2))::text,true);
select throws_ok($$select public.clear_resource_evidence(pg_temp.cid(100))$$,'P0002','RESOURCE_NOT_FOUND','other owner cannot clear or discover the chain');
select is_empty($$select id from public.resource_runs where id=pg_temp.cid(100)$$,'other owner cannot directly read cleared receipt');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(1),'client_id','extension')::text,true);
select throws_ok($$select public.clear_resource_evidence(pg_temp.cid(100))$$,'42501','RESOURCE_FORBIDDEN','extension cannot use Web clearing');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(1),'is_anonymous',true)::text,true);
select throws_ok($$select public.clear_resource_evidence(pg_temp.cid(100))$$,'42501','RESOURCE_FORBIDDEN','anonymous signed-in account denied');
reset role;
set local role anon;
select throws_ok($$select public.clear_resource_evidence(pg_temp.cid(100))$$,'42501',null,'anonymous role cannot invoke clearing');
reset role;
set local role service_role;
select throws_ok($$select public.clear_resource_evidence(pg_temp.cid(100))$$,'42501',null,'service worker cannot clear user evidence');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid(1))::text,true);
-- A separate in-flight verification is cleared without refund or proposal creation.
select pg_temp.seed_chain(300);
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(310,302))->>'status','queued','independent adoption starts');
reset role;
set local role service_role;
select is(public.claim_resource_adoption(pg_temp.cid(1),pg_temp.cid(310),pg_temp.cid(311))->'acquired','true'::jsonb,'verification in progress');
reset role;
set local role authenticated;
select is(public.clear_resource_evidence(pg_temp.cid(302))->>'status','cleared','running adoption source cleared');
reset role;
set local role service_role;
select is(public.finish_resource_adoption(pg_temp.cid(1),pg_temp.cid(310),pg_temp.cid(311),current_setting('clear.verified')::jsonb)->>'status','cleared','late verification cannot create a proposal');
reset role;
select is((select available_attempts from private.resource_adoption_quotas where owner_id=pg_temp.cid(1)),18,'running adoption not refunded');
select ok((select proposal_id is null from public.resource_adoptions where id=pg_temp.cid(310)),'late verification left proposal absent');
-- Applied decisions and formal learning history survive exactly.
select pg_temp.seed_chain(400);
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(410,402))->>'status','queued','adoption for historical decision starts');
reset role;
set local role service_role;
select is(public.claim_resource_adoption(pg_temp.cid(1),pg_temp.cid(410),pg_temp.cid(411))->'acquired','true'::jsonb,'claim historical decision');
select set_config('clear.applied',public.finish_resource_adoption(pg_temp.cid(1),pg_temp.cid(410),pg_temp.cid(411),current_setting('clear.verified')::jsonb)::text,true);
reset role;
set local role authenticated;
select is(public.apply_blueprint_proposal((current_setting('clear.applied')::jsonb->>'proposal_id')::uuid,0,pg_temp.cid(412)),1::bigint,'user explicitly adopts into formal Blueprint');
select lives_ok($$select public.record_learning_note(pg_temp.cid(12),(current_setting('clear.applied')::jsonb->>'new_binding_id')::uuid,1,'User private note',75,pg_temp.cid(413))$$,'formal note recorded separately');
reset role;
insert into public.learning_sessions(owner_id,node_id,resource_binding_id,source,started_at,client_mutation_id) values(pg_temp.cid(1),pg_temp.cid(12),(current_setting('clear.applied')::jsonb->>'new_binding_id')::uuid,'extension',now(),pg_temp.cid(414));
select set_config('clear.formal',jsonb_build_object('snapshot',public.read_blueprint_snapshot_v2(pg_temp.cid(1)),
 'notes',(select jsonb_agg(to_jsonb(n)) from public.learning_notes n where owner_id=pg_temp.cid(1)),
 'sessions',(select jsonb_agg(to_jsonb(s)) from public.learning_sessions s where owner_id=pg_temp.cid(1)),
 'revisions',(select jsonb_agg(to_jsonb(r)) from public.blueprint_revisions r where owner_id=pg_temp.cid(1)),
 'proposal',(select to_jsonb(p) from public.blueprint_proposals p where id=(current_setting('clear.applied')::jsonb->>'proposal_id')::uuid))::text,true);
set local role authenticated;
select is(public.clear_resource_evidence(pg_temp.cid(400))->>'status','cleared','clear previously applied source evidence');
select is(public.apply_blueprint_proposal((current_setting('clear.applied')::jsonb->>'proposal_id')::uuid,0,pg_temp.cid(412)),1::bigint,'applied exact replay retains original revision');
reset role;
select is(jsonb_build_object('snapshot',public.read_blueprint_snapshot_v2(pg_temp.cid(1)),
 'notes',(select jsonb_agg(to_jsonb(n)) from public.learning_notes n where owner_id=pg_temp.cid(1)),
 'sessions',(select jsonb_agg(to_jsonb(s)) from public.learning_sessions s where owner_id=pg_temp.cid(1)),
 'revisions',(select jsonb_agg(to_jsonb(r)) from public.blueprint_revisions r where owner_id=pg_temp.cid(1)),
 'proposal',(select to_jsonb(p) from public.blueprint_proposals p where id=(current_setting('clear.applied')::jsonb->>'proposal_id')::uuid)),current_setting('clear.formal')::jsonb,'clear and historical replay preserve exact formal snapshot, revisions, proposal, sessions and private notes');
select * from finish();
rollback;
