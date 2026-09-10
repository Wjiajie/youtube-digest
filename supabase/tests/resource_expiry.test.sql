begin;
select no_plan();
create function pg_temp.eid(n integer) returns uuid language sql as $$select ('ef650000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.eid(1),'expiry-owner@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.eid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.eid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.eid(11),pg_temp.eid(1),pg_temp.eid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.eid(12),pg_temp.eid(1),pg_temp.eid(11),'learn','Node',0);
insert into private.resource_quotas values(pg_temp.eid(1),'discover',20),(pg_temp.eid(1),'captions',20),(pg_temp.eid(1),'match',20);
create function pg_temp.discover(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','discover','runId',pg_temp.eid(n),'nodeId',pg_temp.eid(12),'expectedBlueprintVersion',0,
 'preferences',jsonb_build_object('regionCode','US','language','en','allowLanguageFallback',false,'maxDurationSeconds',3600,'publishedAfter',null),
 'learnerContext',jsonb_build_object('startingPoint',null,'constraints',null))$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.eid(1),'role','authenticated')::text,true);
select throws_ok($$select public.begin_resource_run(pg_temp.discover(20))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','no operator policy means no reservation or provider work');
reset role;
select is((select available_attempts from private.resource_quotas where owner_id=pg_temp.eid(1) and kind='discover'),20,'denied discovery leaves quota unchanged');
insert into private.resource_retention_policies values(pg_temp.eid(1),1,'local-fixture-only');
set local role authenticated;
select set_config('expiry.root',public.begin_resource_run(pg_temp.discover(30))::text,true);
select ok((current_setting('expiry.root')::jsonb->>'source_started_at')::timestamptz<=clock_timestamp(),'source age begins at trusted database time');
select is((current_setting('expiry.root')::jsonb->>'content_expires_at')::timestamptz-(current_setting('expiry.root')::jsonb->>'source_started_at')::timestamptz,interval '1 second','operator cap captured exactly');
select throws_ok($$select public.begin_resource_run(pg_temp.discover(40)||'{"content_expires_at":"2099-01-01T00:00:00Z"}')$$,'22023','RESOURCE_INVALID','client cannot supply a deadline');
reset role;
select pg_sleep(1.05);
set local role authenticated;
select is_empty($$select id from public.resource_runs where id=pg_temp.eid(30)$$,'direct Data API RLS hides expired body before cleanup');
select is(public.read_resource_run(pg_temp.eid(30))->>'status','cleared','public read clears expired evidence rather than returning stale body');
select is(public.read_resource_run(pg_temp.eid(30))->>'clear_reason','expired','automatic receipt differs from manual clear');
reset role;
select is((select available_attempts from private.resource_quotas where owner_id=pg_temp.eid(1) and kind='discover'),20,'expired queued work refunded exactly once');
alter table public.resource_runs disable trigger resource_run_content_lifetime;
select throws_ok($$update public.resource_runs set content_expires_at=null where id=pg_temp.eid(30)$$,'23514',null,'partial metadata cannot exploit SQL CHECK NULL truth semantics');
alter table public.resource_runs enable trigger resource_run_content_lifetime;
select throws_ok($$update public.resource_runs set content_expires_at=clock_timestamp()+interval '1 day' where id=pg_temp.eid(30)$$,'22023','RESOURCE_RETENTION_IMMUTABLE','deadline cannot be extended even by an accidental maintenance update');
select is(private.sweep_resource_content(10),0,'repeat sweep has no active work');
-- Valid saved evidence fixture; adoption and lifecycle transitions use public RPCs.
create function pg_temp.chain(n integer) returns void language plpgsql as $$begin
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.eid(n),owner_id,id,version,pg_temp.eid(12),'discover',pg_temp.discover(n)->'preferences',pg_temp.discover(n)->'learnerContext',public.read_blueprint_snapshot_v2(owner_id),
 '{"status":"discovered","candidates":[{"video":{"videoId":"abcdefghijk","title":"Private metadata"},"eligibleForMatching":true,"transcript":{"status":"ready","segments":[{"text":"Private transcript"}]}}]}','ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.eid(1);
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.eid(n+1),owner_id,blueprint_id,blueprint_version,node_id,'captions',id,preferences,learner_context,input_blueprint,result,result,'ready',expires_at from public.resource_runs where id=pg_temp.eid(n);
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.eid(n+2),owner_id,blueprint_id,blueprint_version,node_id,'match',id,preferences,learner_context,input_blueprint,result,
 '{"status":"matched","summary":"Private interpretation","assessments":[{"videoId":"abcdefghijk","role":"recommended"}]}','ready',expires_at from public.resource_runs where id=pg_temp.eid(n+1);
end $$;
create function pg_temp.adopt(n integer,s integer) returns jsonb language sql as $$select jsonb_build_object('adoptionId',pg_temp.eid(n),'sourceRunId',pg_temp.eid(s),'videoId','abcdefghijk','replaceBindingId',null)$$;
insert into private.resource_adoption_quotas values(pg_temp.eid(1),10);
update private.resource_retention_policies set window_seconds=2 where owner_id=pg_temp.eid(1);
select pg_temp.chain(100);
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(200,102))->>'status','queued','adoption starts with live root');
reset role;
select is((select count(distinct (source_started_at,content_expires_at,retention_policy_ref)) from (
 select source_started_at,content_expires_at,retention_policy_ref from public.resource_runs where id in(pg_temp.eid(100),pg_temp.eid(101),pg_temp.eid(102))
 union all select source_started_at,content_expires_at,retention_policy_ref from public.resource_adoptions where id=pg_temp.eid(200)) all_copies),1::bigint,'captions, match and adoption inherit exact oldest root lifetime');
update private.resource_retention_policies set window_seconds=86400,policy_ref='next-root-only' where owner_id=pg_temp.eid(1);
select is((select content_expires_at-source_started_at from public.resource_runs where id=pg_temp.eid(100)),interval '2 seconds','operator policy edit cannot extend existing evidence');
set local role service_role;
select ok((public.claim_resource_adoption(pg_temp.eid(1),pg_temp.eid(200),pg_temp.eid(201))->>'acquired')::boolean,'worker claims current evidence');
select set_config('expiry.verified','{"status":"verified","video":{"videoId":"abcdefghijk","title":"Fresh title","channelTitle":"Channel","publishedAt":"2026-01-01T00:00:00Z","durationSeconds":900}}',true);
select set_config('expiry.prepared',public.finish_resource_adoption(pg_temp.eid(1),pg_temp.eid(200),pg_temp.eid(201),current_setting('expiry.verified')::jsonb)::text,true);
reset role;
select is((current_setting('expiry.prepared')::jsonb->>'content_expires_at')::timestamptz,(select content_expires_at from public.resource_runs where id=pg_temp.eid(100)),'fresh verification never refreshes the old source deadline');
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(210,102))->>'status','queued','unclaimed verification exists at expiry');
reset role;
select pg_sleep(2.05);
set local role authenticated;
select is_empty($$select result from public.resource_adoptions where id=pg_temp.eid(200)$$,'direct adoption select also hides expired metadata');
select throws_ok($$select public.apply_blueprint_proposal((current_setting('expiry.prepared')::jsonb->>'proposal_id')::uuid,0,pg_temp.eid(202))$$,'40001','RESOURCE_ADOPTION_SOURCE_CHANGED','apply hard gate refuses expired evidence before sweep');
reset role;
select is(private.sweep_resource_content(1),1,'non-active owner evidence clears without a user read');
select is(private.sweep_resource_content(1),0,'maintenance sweep is idempotent');
select is((select count(*) from public.resource_runs where id in(pg_temp.eid(100),pg_temp.eid(101),pg_temp.eid(102)) and status='cleared' and clear_reason='expired' and input_discovery is null and result is null and preferences is null and input_blueprint is null),3::bigint,'sweep erases every input and result copy in the chain');
select is((select status from public.blueprint_proposals where id=(current_setting('expiry.prepared')::jsonb->>'proposal_id')::uuid),'rejected','unapplied draft invalidated atomically');
select is((select available_attempts from private.resource_adoption_quotas where owner_id=pg_temp.eid(1)),9,'only unclaimed verification refunded');
set local role service_role;
select is(public.finish_resource_adoption(pg_temp.eid(1),pg_temp.eid(200),pg_temp.eid(201),'{}')->>'status','cleared','matching lease late completion cannot revive expired verification');
select is(public.claim_resource_adoption(pg_temp.eid(1),pg_temp.eid(210),pg_temp.eid(211))->'acquired','false'::jsonb,'expired queued verification cannot start providers');
reset role;
select is((select completion_digest from private.resource_adoption_leases where adoption_id=pg_temp.eid(200)),sha256(convert_to(current_setting('expiry.verified')::jsonb::text,'UTF8')),'original completion digest survives automatic clearing');
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(200,102))->>'status','cleared','old adoption identity recovers expired receipt without charging');
select is(public.begin_resource_run(pg_temp.discover(100))->>'status','cleared','old discovery identity recovers expired receipt');
select is(public.clear_resource_evidence(pg_temp.eid(100))->>'clear_reason','expired','manual retry never rewrites automatic reason');
select throws_ok($$select public.begin_resource_run(jsonb_build_object('runId',pg_temp.eid(103),'sourceRunId',pg_temp.eid(101),'kind','match'))$$,'22023','RESOURCE_INVALID_STATE','no new child can consume expired evidence');
reset role;
-- A legacy fixture is introduced as it would exist before the schema-only upgrade.
select pg_temp.chain(500);
insert into public.resource_adoptions(id,owner_id,source_run_id,blueprint_id,blueprint_version,node_id,video_id,new_binding_id,status,expires_at)
 select pg_temp.eid(510),owner_id,id,blueprint_id,blueprint_version,node_id,'abcdefghijk',pg_temp.eid(512),'running',clock_timestamp()+interval '120 seconds' from public.resource_runs where id=pg_temp.eid(502);
insert into private.resource_adoption_leases values(pg_temp.eid(510),pg_temp.eid(511),null);
insert into private.resource_leases values(pg_temp.eid(500),pg_temp.eid(503),null);
alter table public.resource_adoptions disable trigger resource_adoption_content_lifetime;
update public.resource_adoptions set source_started_at=null,content_expires_at=null,retention_policy_ref=null where id=pg_temp.eid(510);
alter table public.resource_adoptions enable trigger resource_adoption_content_lifetime;
alter table public.resource_runs disable trigger resource_run_content_lifetime;
update public.resource_runs set source_started_at=null,content_expires_at=null,retention_policy_ref=null where id in(pg_temp.eid(500),pg_temp.eid(501),pg_temp.eid(502));
alter table public.resource_runs enable trigger resource_run_content_lifetime;
set local role authenticated;
select is_empty($$select id from public.resource_runs where id=pg_temp.eid(500)$$,'legacy body hidden by RLS');
select throws_ok($$select public.read_resource_run(pg_temp.eid(500))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','legacy definer read does not bypass lifetime');
select throws_ok($$select public.cancel_resource_run(pg_temp.eid(500))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','legacy cancellation does not return ungoverned body');
select throws_ok($$select public.begin_resource_run(pg_temp.discover(500))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','legacy identity replay cannot disclose body');
select throws_ok($$select public.begin_resource_adoption(pg_temp.adopt(520,502))$$,'40001','RESOURCE_ADOPTION_SOURCE_CHANGED','legacy source cannot be adopted');
select throws_ok($$select public.begin_resource_adoption(pg_temp.adopt(510,502))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','legacy adoption replay cannot return body');
select throws_ok($$select public.read_resource_adoption(pg_temp.eid(510))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','legacy adoption definer read denies body');
select is_empty($$select id from public.resource_adoptions where id=pg_temp.eid(510)$$,'legacy adoption RLS denies body');
reset role;
set local role service_role;
select throws_ok($$select public.claim_resource_run(pg_temp.eid(1),pg_temp.eid(500),pg_temp.eid(504),null)$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','worker cannot claim unmanaged evidence');
select throws_ok($$select public.finish_resource_run(pg_temp.eid(1),pg_temp.eid(500),pg_temp.eid(503),'{}')$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','worker completion cannot restore unmanaged run body');
select throws_ok($$select public.claim_resource_adoption(pg_temp.eid(1),pg_temp.eid(510),pg_temp.eid(511))$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','worker cannot claim unmanaged verification');
select throws_ok($$select public.finish_resource_adoption(pg_temp.eid(1),pg_temp.eid(510),pg_temp.eid(511),'{}')$$,'P0001','RESOURCE_RETENTION_UNAVAILABLE','worker cannot finish unmanaged verification');
reset role;
set local role authenticated;
select is(public.begin_resource_run(pg_temp.discover(600))->>'status','queued','one unmanaged chain does not globally block managed work');
select is(public.read_resource_run(pg_temp.eid(600))->>'retention_policy_ref','next-root-only','new root takes new operator policy');
select is(public.clear_resource_evidence(pg_temp.eid(500))->>'clear_reason','manual','manual clear remains available for unknown legacy lifetime');
select is(public.clear_resource_evidence(pg_temp.eid(600))->>'clear_reason','manual','managed manual clear distinguished from expiry');
select throws_ok($$select private.sweep_resource_content(1)$$,'42501',null,'user cannot invoke maintenance');
select throws_ok($$select private.clear_resource_chain(pg_temp.eid(1),pg_temp.eid(100),'manual')$$,'42501',null,'user cannot bypass authenticated clear wrapper');
select throws_ok($$select * from private.resource_retention_policies$$,'42501',null,'operator policies are not exposed');
reset role;
set local role service_role;
select throws_ok($$select private.sweep_resource_content(1)$$,'42501',null,'worker cannot invoke global deletion');
reset role;
set local role anon;
select throws_ok($$select private.sweep_resource_content(1)$$,'42501',null,'anonymous cannot invoke global deletion');
reset role;
select throws_ok($$select private.sweep_resource_content(0)$$,'22023','RESOURCE_SWEEP_LIMIT_INVALID','maintenance requires a bounded positive batch');
select throws_ok($$select private.sweep_resource_content(1001)$$,'22023','RESOURCE_SWEEP_LIMIT_INVALID','maintenance batch has a hard upper bound');
-- Original claimed run: no refund and no digest written after deadline.
update private.resource_retention_policies set window_seconds=1 where owner_id=pg_temp.eid(1);
set local role authenticated;
select is(public.begin_resource_run(pg_temp.discover(700))->>'status','queued','reserve short-lived running fixture');
reset role;
set local role service_role;
select ok((public.claim_resource_run(pg_temp.eid(1),pg_temp.eid(700),pg_temp.eid(701),null)->>'acquired')::boolean,'provider lease acquired before content expiry');
reset role;
select set_config('expiry.quota',(select available_attempts::text from private.resource_quotas where owner_id=pg_temp.eid(1) and kind='discover'),true);
select pg_sleep(1.05);
set local role service_role;
select is(public.finish_resource_run(pg_temp.eid(1),pg_temp.eid(700),pg_temp.eid(701),'{}')->>'status','cleared','late run completion uses sanitized expiry receipt');
select throws_ok($$select public.finish_resource_run(pg_temp.eid(1),pg_temp.eid(700),pg_temp.eid(702),'{}')$$,'42501','RESOURCE_FORBIDDEN','automatic clearing does not relax original lease validation');
reset role;
select is((select available_attempts::text from private.resource_quotas where owner_id=pg_temp.eid(1) and kind='discover'),current_setting('expiry.quota'),'claimed work never receives a refund');
select ok((select completion_digest is null from private.resource_leases where run_id=pg_temp.eid(700)),'no new content hash persisted after expiry');
select ok((select cleared_at>=content_expires_at from public.resource_runs where id=pg_temp.eid(700)),'automatic clear timestamp cannot precede deadline');
-- Automatic expiry preserves user-approved decisions and independent learning history.
update private.resource_retention_policies set window_seconds=2 where owner_id=pg_temp.eid(1);
select pg_temp.chain(800);
set local role authenticated;
select is(public.begin_resource_adoption(pg_temp.adopt(810,802))->>'status','queued','fresh verification for official adoption');
reset role;
set local role service_role;
select ok((public.claim_resource_adoption(pg_temp.eid(1),pg_temp.eid(810),pg_temp.eid(811))->>'acquired')::boolean,'claim before approval');
select set_config('expiry.applied',public.finish_resource_adoption(pg_temp.eid(1),pg_temp.eid(810),pg_temp.eid(811),current_setting('expiry.verified')::jsonb)::text,true);
reset role;
set local role authenticated;
select is(public.apply_blueprint_proposal((current_setting('expiry.applied')::jsonb->>'proposal_id')::uuid,0,pg_temp.eid(812)),1::bigint,'approved proposal becomes official before expiry');
select lives_ok($$select public.record_learning_note(pg_temp.eid(12),(current_setting('expiry.applied')::jsonb->>'new_binding_id')::uuid,1,'User-owned note',75,pg_temp.eid(813))$$,'independent private learning note saved');
reset role;
insert into public.learning_sessions(owner_id,node_id,resource_binding_id,source,started_at,client_mutation_id) values(pg_temp.eid(1),pg_temp.eid(12),(current_setting('expiry.applied')::jsonb->>'new_binding_id')::uuid,'extension',now(),pg_temp.eid(814));
create function pg_temp.formal() returns jsonb language sql as $$select jsonb_build_object('snapshot',public.read_blueprint_snapshot_v2(pg_temp.eid(1)),
 'notes',(select jsonb_agg(to_jsonb(n)) from public.learning_notes n where owner_id=pg_temp.eid(1)),
 'sessions',(select jsonb_agg(to_jsonb(s)) from public.learning_sessions s where owner_id=pg_temp.eid(1)),
 'revisions',(select jsonb_agg(to_jsonb(r)) from public.blueprint_revisions r where owner_id=pg_temp.eid(1)),
 'proposal',(select to_jsonb(p) from public.blueprint_proposals p where id=(current_setting('expiry.applied')::jsonb->>'proposal_id')::uuid))$$;
select set_config('expiry.formal',pg_temp.formal()::text,true);
select pg_sleep(2.05);
select is(private.sweep_resource_content(1),1,'unattended sweep also clears applied verification content');
set local role authenticated;
select is(public.read_resource_adoption(pg_temp.eid(810))->>'clear_reason','expired','applied adoption retains a sanitized expiry receipt');
select is(public.apply_blueprint_proposal((current_setting('expiry.applied')::jsonb->>'proposal_id')::uuid,0,pg_temp.eid(812)),1::bigint,'exact applied retry recovers original historical revision');
reset role;
select is(pg_temp.formal(),current_setting('expiry.formal')::jsonb,'automatic expiry and retry preserve exact official path, proposal, revisions, sessions and notes');
select * from finish();
rollback;
