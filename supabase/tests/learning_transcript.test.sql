begin;
select no_plan();
create function pg_temp.tid(n integer) returns uuid language sql as $$select ('ef680000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.tid(1),'transcript-owner@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.tid(10),owner_id,id,'Current goal',0 from public.blueprints where owner_id=pg_temp.tid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.tid(11),pg_temp.tid(1),pg_temp.tid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.tid(12),pg_temp.tid(1),pg_temp.tid(11),'learn','Current node',0);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
 values(pg_temp.tid(13),pg_temp.tid(1),pg_temp.tid(12),'youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk',0);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_acquired','bound resource with no acquired source is explicitly unavailable');
reset role;
insert into private.resource_retention_policies values(pg_temp.tid(1),86400,'local-transcript-only');
create function pg_temp.source(n integer,caption jsonb) returns void language sql as $$
 insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,preferences,learner_context,input_blueprint,result,status,expires_at)
 select pg_temp.tid(n),owner_id,id,version,pg_temp.tid(12),'discover','{}','{}',public.read_blueprint_snapshot_v2(owner_id),
 jsonb_build_object('status','discovered','candidates',jsonb_build_array(jsonb_build_object('video',jsonb_build_object('videoId','abcdefghijk','title','Saved video'),
 'transcript',caption))),'ready',clock_timestamp()+interval '120 seconds' from public.blueprints where owner_id=pg_temp.tid(1)
$$;
select pg_temp.source(20,jsonb_build_object('status','ready','language','en','segments',
 (select jsonb_agg(jsonb_build_object('text','Segment '||n,'offset',n*1000,'duration',900) order by n) from generate_series(0,24) n)));
set local role authenticated;
select set_config('transcript.first',public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')::text,true);
select is(current_setting('transcript.first')::jsonb->>'status','ready','owner can read original acquired transcript page');
select is(jsonb_array_length(current_setting('transcript.first')::jsonb->'segments'),20,'first page contains twenty segments');
select is(current_setting('transcript.first')::jsonb#>>'{segments,0,text}','Segment 0','original first text is unchanged');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20),20)#>>'{segments,4,text}','Segment 24','second page stays pinned and preserves order');
reset role;
select pg_temp.source(21,'{"status":"ready","language":"en","segments":[{"text":"  \t\n","offset":0,"duration":1}]}');
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_available','blank malformed caption is unavailable, not a ready page');
reset role;
set local role authenticated;
select is((select array_agg(key order by key) from jsonb_object_keys(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))) key),
 array['contentExpiresAt','context','language','observedAt','offset','ownerId','segments','sourceBlueprintVersion','sourceCreatedAt','sourceRunId','status','title','totalSegments'],'ready envelope is exactly the bounded allowlist');
select is((select array_agg(key order by key) from jsonb_object_keys(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')) key),
 array['context','observedAt','ownerId','reason','status'],'unavailable never contains previous body or source internals');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))#>>'{segments,1,offsetMs}','1000','native transcript offsets remain milliseconds');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20),40)->'segments','[]'::jsonb,'beyond-end page is empty rather than switching source');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',null,20)$$,'22023','LEARNING_TRANSCRIPT_INVALID','later page requires a pinned source');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20),1)$$,'22023','LEARNING_TRANSCRIPT_INVALID','offset must be a twenty-segment boundary');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20),20000)$$,'22023','LEARNING_TRANSCRIPT_INVALID','offset upper bound enforced');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'bad')$$,'22023','LEARNING_TRANSCRIPT_INVALID','invalid video identity rejected');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(99),'abcdefghijk')$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','missing binding never discloses source');
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'zyxwvutsrqp')$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','expected video must match current binding');
reset role;

-- Blueprint version changes after adoption; previously acquired original text
-- remains readable only for the still-current binding and original deadline.
update public.blueprints set version=1 where owner_id=pg_temp.tid(1);
update public.resource_runs set status='stale' where id=pg_temp.tid(20);
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))->>'sourceBlueprintVersion','0','old acquisition revision remains explicit after current version changes');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))->>'status','ready','stale planning relevance does not erase current bound-video captions');
reset role;
select pg_temp.source(22,'{"status":"pending","jobId":"NEVER_RETURN_JOB"}');
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','pending','newest pending source does not fall back to older complete text');
select ok(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')::text not like '%NEVER_RETURN_JOB%','pending response omits provider job identity');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))->>'sourceRunId',pg_temp.tid(20)::text,'explicit paging retains original source despite newer acquisition');
reset role;
select pg_temp.source(23,'{"status":"not_found"}');
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_available','newest missing captions do not silently use older body');
reset role;
select pg_temp.source(24,jsonb_build_object('status','ready','language','zh','segments',jsonb_build_array(jsonb_build_object('text','  <script>原文</script>  ','offset',0.5,'duration',1.25))));
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')#>>'{segments,0,text}','  <script>原文</script>  ','verbatim original whitespace and markup are returned as plain text data');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')#>>'{segments,0,durationMs}','1.25','fractional native milliseconds are not rounded');
reset role;
select pg_temp.source(25,jsonb_build_object('status','ready','language','en','segments',jsonb_build_array(jsonb_build_object('text',repeat('😀',10000),'offset',0,'duration',1))));
set local role authenticated;
select is(length(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')#>>'{segments,0,text}'),10000,'twenty thousand JS code units are preserved without truncation');
reset role;
select pg_temp.source(26,jsonb_build_object('status','ready','language','en','segments',jsonb_build_array(jsonb_build_object('text',repeat('😀',10001),'offset',0,'duration',1))));
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_available','JS code-unit bound rejects oversized astral text');
reset role;
select pg_temp.source(27,'{"status":"ready","language":"en","segments":[{"text":"Bad end","offset":9007199254740991,"duration":1}]}');
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_available','unsafe summed end cannot enter a navigation timestamp');
reset role;

-- Known OAuth gets the narrow projection, never raw resource bodies.
insert into private.app_config(key,value) values('extension_oauth_client_id','transcript-extension') on conflict(key) do update set value=excluded.value;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id','transcript-extension')::text,true);
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))->>'status','ready','configured extension client can read one bound-video page');
select is_empty($$select id from public.resource_runs where owner_id=pg_temp.tid(1)$$,'extension still cannot select raw resource runs');
select throws_ok($$select public.read_resource_run(pg_temp.tid(20))$$,'42501','RESOURCE_FORBIDDEN','old raw-body RPC remains web-only');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','client_id','unknown-client')::text,true);
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')$$,'42501','LEARNING_TRANSCRIPT_FORBIDDEN','unknown OAuth client is forbidden');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated','is_anonymous',true)::text,true);
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')$$,'42501','LEARNING_TRANSCRIPT_FORBIDDEN','anonymous Auth user is forbidden');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(2),'role','authenticated')::text,true);
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','another account cannot use a known binding');
reset role;
set local role anon;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')$$,'42501',null,'anonymous database role lacks execution');
reset role;
set local role service_role;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')$$,'42501',null,'worker role lacks projection execution');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(1),'role','authenticated')::text,true);
select public.clear_resource_evidence(pg_temp.tid(20));
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(20))->>'reason','cleared','pinned cleared source returns a body-free tombstone');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(999))->>'reason','not_acquired','missing explicit source never switches to another acquisition');
reset role;
update private.resource_retention_policies set window_seconds=1 where owner_id=pg_temp.tid(1);
select pg_temp.source(30,'{"status":"ready","language":"en","segments":[{"text":"Expires","offset":0,"duration":1}]}');
select set_config('transcript.saved', (select to_jsonb(r)::text from public.resource_runs r where id=pg_temp.tid(30)),true);
select pg_sleep(1.05);
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','expired','newest expired source is not replaced by older text');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(30))->>'reason','expired','pinned source respects original content deadline');
reset role;
select is((select to_jsonb(r) from public.resource_runs r where id=pg_temp.tid(30)),current_setting('transcript.saved')::jsonb,'expired read is pure and neither clears nor rewrites source');
select is((select count(*) from private.resource_quotas where owner_id=pg_temp.tid(1)),0::bigint,'reading cannot create charges or refunds');
update public.resource_bindings set archived_at=clock_timestamp() where id=pg_temp.tid(13);
set local role authenticated;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(24))$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','archived binding stops historical body access');
reset role;
update public.resource_bindings set archived_at=null,external_id='zyxwvutsrqp',url='https://www.youtube.com/watch?v=zyxwvutsrqp' where id=pg_temp.tid(13);
set local role authenticated;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(24))$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','in-place binding video change cannot disclose old video');
select is(public.read_learning_transcript(pg_temp.tid(13),'zyxwvutsrqp',pg_temp.tid(24))->>'reason','not_acquired','explicit source must contain the expected current video');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.read_learning_transcript(uuid,text,uuid,integer)'::regprocedure),'public projection wrapper remains invoker');
update public.resource_bindings set external_id='abcdefghijk',url='https://www.youtube.com/watch?v=abcdefghijk' where id=pg_temp.tid(13);
update private.resource_retention_policies set window_seconds=86400 where owner_id=pg_temp.tid(1);
insert into public.resource_runs(id,owner_id,blueprint_id,blueprint_version,node_id,kind,source_run_id,preferences,learner_context,input_blueprint,input_discovery,result,status,expires_at)
 select pg_temp.tid(40),owner_id,blueprint_id,blueprint_version,node_id,'match',id,preferences,learner_context,input_blueprint,result,'{"status":"no_match"}','ready',expires_at from public.resource_runs where id=pg_temp.tid(24);
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(40))#>>'{segments,0,text}','  <script>原文</script>  ','match source reads inherited original discovery, not model commentary');
reset role;
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.tid(50),pg_temp.tid(1),pg_temp.tid(11),'learn','Different node',1);
update public.resource_runs set node_id=pg_temp.tid(50) where id=pg_temp.tid(40);
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(40))->>'reason','not_acquired','same owner and video never suffice for another node source');
reset role;
-- Explicit local legacy fixture: no migration backfill or real-account change.
alter table public.resource_runs disable trigger resource_run_content_lifetime;
update public.resource_runs set source_started_at=null,content_expires_at=null,retention_policy_ref=null where id=pg_temp.tid(24);
alter table public.resource_runs enable trigger resource_run_content_lifetime;
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(24))->>'reason','not_available','unknown legacy lifetime never emits body or pretends to be an expiry receipt');
reset role;
select pg_temp.source(60,jsonb_build_object('status','ready','language','en','segments',
 (select jsonb_agg(jsonb_build_object('text','L'||n,'offset',n,'duration',1) order by n) from generate_series(1,20000) n)));
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(60),19980)#>>'{segments,19,text}','L20000','last page of maximal twenty-thousand-segment source remains reachable');
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(60),19980)->>'totalSegments','20000','total count describes complete original source');
reset role;
update public.path_nodes set archived_at=clock_timestamp() where id=pg_temp.tid(12);
set local role authenticated;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(60))$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','archived current node blocks access');
reset role;
update public.path_nodes set archived_at=null where id=pg_temp.tid(12);
update public.stages set archived_at=clock_timestamp() where id=pg_temp.tid(11);
set local role authenticated;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(60))$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','archived current stage blocks access');
reset role;
update public.stages set archived_at=null where id=pg_temp.tid(11);
update public.goals set archived_at=clock_timestamp() where id=pg_temp.tid(10);
set local role authenticated;
select throws_ok($$select public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk',pg_temp.tid(60))$$,'P0002','LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND','archived current goal blocks access');
reset role;
update public.goals set archived_at=null where id=pg_temp.tid(10);
select pg_temp.source(61,'{"status":"ready","language":"en","segments":[{"text":"Caption","offset":0,"duration":1}]}');
update public.resource_runs set result=jsonb_set(result,'{candidates,0,video,title}',to_jsonb(repeat('😀',501))) where id=pg_temp.tid(61);
set local role authenticated;
select is(public.read_learning_transcript(pg_temp.tid(13),'abcdefghijk')->>'reason','not_available','video title also obeys shared JS string bound');
reset role;
select * from finish();
rollback;
