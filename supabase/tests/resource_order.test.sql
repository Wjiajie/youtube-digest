begin;
select no_plan();
insert into auth.users(id,email) values('fd000000-0000-4000-8000-000000000001','resource-order@example.test'),('fd000000-0000-4000-8000-000000000002','resource-order-other@example.test');
insert into private.app_config(key,value) values('extension_oauth_client_id','extension') on conflict(key) do update set value=excluded.value;
create function pg_temp.oid(n integer) returns uuid language sql as $$select ('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001"}',true);
select set_config('resource_order.initial',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals}',
 '[{"id":"fd000000-0000-4000-8000-000000000010","title":"Goal","position":0,"stages":[{"id":"fd000000-0000-4000-8000-000000000011","title":"Stage","position":0,"nodes":[{"id":"fd000000-0000-4000-8000-000000000012","type":"learn","title":"First node","position":0,"estimatedMinutes":30,"completionCriteria":"Explain","dependencyIds":[],"resources":[{"id":"fd000000-0000-4000-8000-000000000090","kind":"youtube_video","url":"https://www.youtube.com/watch?v=zzzzzzzzzzz","externalId":"zzzzzzzzzzz"},{"id":"fd000000-0000-4000-8000-000000000080","kind":"youtube_video","url":"https://www.youtube.com/watch?v=yyyyyyyyyyy","externalId":"yyyyyyyyyyy"}]},{"id":"fd000000-0000-4000-8000-000000000013","type":"learn","title":"Second node","position":1,"estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[]}]}]}]'::jsonb)::text,true);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select pg_temp.oid(30),auth.uid(),id,0,current_setting('resource_order.initial')::jsonb,pg_temp.oid(30) from public.blueprints where owner_id=auth.uid();
select is(public.apply_blueprint_proposal(pg_temp.oid(30),0,pg_temp.oid(30)),1::bigint,'manual proposal explicitly confirms');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>>'{goals,0,stages,0,nodes,0,resources,0,id}',pg_temp.oid(90)::text,'accepted resource array order wins over UUID order');
select is(public.read_blueprint_snapshot_v2(auth.uid()),jsonb_set(current_setting('resource_order.initial')::jsonb,'{version}','1'),'public formal snapshot exactly matches accepted ordered proposal');
select is((select snapshot from public.blueprint_revisions where proposal_id=pg_temp.oid(30)),public.read_blueprint_snapshot_v2(auth.uid()),'revision and formal order agree');
insert into public.learning_sessions(owner_id,node_id,resource_binding_id,source,started_at,client_mutation_id)
 values(auth.uid(),pg_temp.oid(12),pg_temp.oid(90),'extension',now(),pg_temp.oid(100));
select set_config('resource_order.session',(select to_jsonb(s)::text from public.learning_sessions s where client_mutation_id=pg_temp.oid(100)),true);
select set_config('resource_order.reversed',jsonb_build_array(
 current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources,1}',
 current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources,0}')::text,true);
select set_config('resource_order.draft',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals,0,stages,0,nodes,0,resources}',current_setting('resource_order.reversed')::jsonb)::text,true);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select pg_temp.oid(31),auth.uid(),id,1,current_setting('resource_order.draft')::jsonb,pg_temp.oid(31) from public.blueprints where owner_id=auth.uid();
select is(public.apply_blueprint_proposal(pg_temp.oid(31),1,pg_temp.oid(31)),2::bigint,'existing binding order can be explicitly changed');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>'{goals,0,stages,0,nodes,0,resources}',current_setting('resource_order.reversed')::jsonb,'reorder retains exact binding identities and selected order');
select is((select to_jsonb(s) from public.learning_sessions s where client_mutation_id=pg_temp.oid(100)),current_setting('resource_order.session')::jsonb,'reordering does not alter any session field');
select set_config('resource_order.third','{"id":"fd000000-0000-4000-8000-000000000070","kind":"youtube_video","url":"https://www.youtube.com/watch?v=xxxxxxxxxxx","externalId":"xxxxxxxxxxx"}',true);
select set_config('resource_order.draft',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals,0,stages,0,nodes,0,resources}',current_setting('resource_order.reversed')::jsonb||jsonb_build_array(current_setting('resource_order.third')::jsonb))::text,true);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select pg_temp.oid(32),auth.uid(),id,2,current_setting('resource_order.draft')::jsonb,pg_temp.oid(32) from public.blueprints where owner_id=auth.uid();
select is(public.apply_blueprint_proposal(pg_temp.oid(32),2,pg_temp.oid(32)),3::bigint,'append confirms once');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>>'{goals,0,stages,0,nodes,0,resources,2,id}',pg_temp.oid(70)::text,'new lower UUID stays at appended position');
select is(public.read_blueprint_snapshot_v2(auth.uid()),(select snapshot from public.blueprint_revisions where proposal_id=pg_temp.oid(32)),'appended order equals immutable revision');
select set_config('resource_order.draft',jsonb_set(jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals,0,stages,0,nodes,0,resources}',
 jsonb_build_array(current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources,1}')),
 '{goals,0,stages,0,nodes,1,resources}',jsonb_build_array(current_setting('resource_order.third')::jsonb))::text,true);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select pg_temp.oid(33),auth.uid(),id,3,current_setting('resource_order.draft')::jsonb,pg_temp.oid(33) from public.blueprints where owner_id=auth.uid();
select is(public.apply_blueprint_proposal(pg_temp.oid(33),3,pg_temp.oid(33)),4::bigint,'remove historical binding and move unused binding confirms');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>>'{goals,0,stages,0,nodes,1,resources,0,id}',pg_temp.oid(70)::text,'unused binding move preserves stable ID');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>>'{goals,0,stages,0,nodes,0,resources,0,id}',pg_temp.oid(80)::text,'removed resource is absent without disturbing remaining order');
select is((select to_jsonb(s) from public.learning_sessions s where client_mutation_id=pg_temp.oid(100)),current_setting('resource_order.session')::jsonb,'removing resource preserves exact historical session attribution');
select ok((select archived_at is not null and external_id='zzzzzzzzzzz' from public.resource_bindings where id=pg_temp.oid(90)),'removed binding retains original video and archived identity');
select set_config('resource_order.current',public.read_blueprint_snapshot_v2(auth.uid())::text,true);
select is(public.apply_blueprint_proposal(pg_temp.oid(30),0,pg_temp.oid(30)),1::bigint,'old exact receipt returns historical applied version');
select is(public.read_blueprint_snapshot_v2(auth.uid()),current_setting('resource_order.current')::jsonb,'historical replay never restores old resource order or bindings');
select is((select snapshot from public.blueprint_revisions where proposal_id=pg_temp.oid(30)),jsonb_set(current_setting('resource_order.initial')::jsonb,'{version}','1'),'historical revision order remains unchanged');
-- The old session tuple forbids moving its binding to another node; preserve that rule.
select set_config('resource_order.draft',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals,0,stages,0,nodes,1,resources}',
 jsonb_build_array(current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources,0}',current_setting('resource_order.third')::jsonb))::text,true);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
 select pg_temp.oid(34),auth.uid(),id,4,current_setting('resource_order.draft')::jsonb,pg_temp.oid(34) from public.blueprints where owner_id=auth.uid();
select throws_ok($$select public.apply_blueprint_proposal(pg_temp.oid(34),4,pg_temp.oid(34))$$,'23503',null,'session-bound resource move still rejects');
select is(public.read_blueprint_snapshot_v2(auth.uid()),current_setting('resource_order.current')::jsonb,'failed move rolls back archived flags and resource positions');
select is((select to_jsonb(s) from public.learning_sessions s where client_mutation_id=pg_temp.oid(100)),current_setting('resource_order.session')::jsonb,'failed move cannot rewrite session context');
select is((select status from public.blueprint_proposals where id=pg_temp.oid(34)),'pending','failed move leaves proposal pending');
update public.blueprint_proposals set proposed_snapshot=jsonb_set(current_setting('resource_order.current')::jsonb,'{goals,0,stages,0,nodes,0,resources,0,position}','999') where id=pg_temp.oid(34);
select throws_ok($$select public.apply_blueprint_proposal(pg_temp.oid(34),4,pg_temp.oid(34))$$,'23514','BLUEPRINT_SNAPSHOT_INVALID','caller resource position remains forbidden');
select is(public.read_blueprint_snapshot_v2(auth.uid()),current_setting('resource_order.current')::jsonb,'invalid position input has no partial ordering effects');
select throws_ok($$select public.apply_blueprint_proposal(pg_temp.oid(34),3,pg_temp.oid(34))$$,'40001','BLUEPRINT_VERSION_CONFLICT','stale confirmation cannot reorder');
select throws_ok($$select private.apply_blueprint_proposal_core(pg_temp.oid(34),4,pg_temp.oid(34))$$,'42501',null,'common writer remains inaccessible directly');
-- A linked planning proposal orders restored bindings and preserves another node.
select lives_ok($$select public.save_goal_brief(pg_temp.oid(40),0,'{"schemaVersion":1,"outcome":"Continue learning","startingPoint":"Some experience","targetDate":null,"weeklyMinutes":120,"constraints":"","successCriteria":"Explain a result"}',true,pg_temp.oid(40))$$,'confirmed Goal Brief for planning');
select set_config('resource_order.planning',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals,0,stages,0,nodes,0,resources}',
 current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources}')::text,true);
reset role;
insert into public.path_planning_runs(id,owner_id,brief_id,blueprint_id,brief_revision,blueprint_version,start_date,status,input_brief,input_blueprint,skill,result,expires_at)
 select pg_temp.oid(41),b.owner_id,b.id,b.blueprint_id,b.revision,4,current_date,'ready',
 jsonb_build_object('id',b.id,'blueprintId',b.blueprint_id,'revision',b.revision,'status',b.status,'content',b.content,'updatedAt',b.updated_at),
 current_setting('resource_order.current')::jsonb,'{}',jsonb_build_object('status','ready','providerMayHaveRun',true,
 'usage',jsonb_build_object('inputTokens',1,'outputTokens',1,'totalTokens',2),'draft',current_setting('resource_order.planning')::jsonb,
 'schedule',jsonb_build_array(jsonb_build_object('nodeId',pg_temp.oid(12),'week',1)),'assumptions','[]'::jsonb,'skill','{}'::jsonb,'source','{}'::jsonb),clock_timestamp()+interval '120 seconds'
 from public.goal_briefs b where b.id=pg_temp.oid(40);
set local role authenticated;
select set_config('resource_order.planning_proposal',public.prepare_path_planning_proposal(pg_temp.oid(41))#>>'{proposal,id}',true);
select is(public.apply_blueprint_proposal(current_setting('resource_order.planning_proposal')::uuid,4,pg_temp.oid(41)),5::bigint,'linked planning proposal shares ordering writer');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>'{goals,0,stages,0,nodes,0,resources}',current_setting('resource_order.initial')::jsonb#>'{goals,0,stages,0,nodes,0,resources}','planning uses accepted array rather than UUID sort');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>'{goals,0,stages,0,nodes,1,resources}',jsonb_build_array(current_setting('resource_order.third')::jsonb),'planning preserves other node binding order');
select is(public.read_blueprint_snapshot_v2(auth.uid()),(select snapshot from public.blueprint_revisions where proposal_id=current_setting('resource_order.planning_proposal')::uuid),'planning snapshot equals its revision');
select is((select to_jsonb(s) from public.learning_sessions s where client_mutation_id=pg_temp.oid(100)),current_setting('resource_order.session')::jsonb,'restoring old binding preserves original session');
select set_config('resource_order.current',public.read_blueprint_snapshot_v2(auth.uid())::text,true);
select set_config('resource_order.planning',jsonb_set(public.read_blueprint_snapshot_v2(auth.uid()),'{goals}',
 (public.read_blueprint_snapshot_v2(auth.uid())->'goals')||'[{"id":"fd000000-0000-4000-8000-000000000050","title":"Another Goal","position":1,"stages":[{"id":"fd000000-0000-4000-8000-000000000051","title":"Start","position":0,"nodes":[{"id":"fd000000-0000-4000-8000-000000000052","type":"practice","title":"Practice","position":0,"estimatedMinutes":30,"completionCriteria":"Produce a result","dependencyIds":[],"resources":[]}]}]}]'::jsonb)::text,true);
reset role;
insert into public.path_planning_runs(id,owner_id,brief_id,blueprint_id,brief_revision,blueprint_version,start_date,status,input_brief,input_blueprint,skill,result,expires_at)
 select pg_temp.oid(42),owner_id,brief_id,blueprint_id,brief_revision,5,start_date,'ready',input_brief,current_setting('resource_order.current')::jsonb,skill,
 jsonb_set(result,'{draft}',current_setting('resource_order.planning')::jsonb),clock_timestamp()+interval '120 seconds' from public.path_planning_runs where id=pg_temp.oid(41);
set local role authenticated;
select set_config('resource_order.next_proposal',public.prepare_path_planning_proposal(pg_temp.oid(42))#>>'{proposal,id}',true);
select is(public.apply_blueprint_proposal(current_setting('resource_order.next_proposal')::uuid,5,pg_temp.oid(42)),6::bigint,'planning addition confirms through same common writer');
select is(public.read_blueprint_snapshot_v2(auth.uid())#>'{goals,0}',current_setting('resource_order.current')::jsonb#>'{goals,0}','planning addition preserves complete unaffected ordered Goal');
select is(public.read_blueprint_snapshot_v2(auth.uid()),(select snapshot from public.blueprint_revisions where proposal_id=current_setting('resource_order.next_proposal')::uuid),'new planning revision and preserved resources agree exactly');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000001","client_id":"extension"}',true);
select is(public.read_blueprint_snapshot_v2(auth.uid())#>>'{goals,0,stages,0,nodes,0,resources,0,id}',pg_temp.oid(90)::text,'extension coherent reader sees accepted order');
select is(public.read_blueprint_snapshot(auth.uid())#>>'{goals,0,stages,0,nodes,0,resources,0,id}',pg_temp.oid(90)::text,'legacy read projection preserves same order');
select throws_ok($$select public.apply_blueprint_proposal(pg_temp.oid(34),4,pg_temp.oid(34))$$,'42501','BLUEPRINT_FORBIDDEN','extension cannot confirm');
select set_config('request.jwt.claims','{"sub":"fd000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.apply_blueprint_proposal(pg_temp.oid(34),4,pg_temp.oid(34))$$,'P0002','PROPOSAL_NOT_FOUND','cross-account confirmation cannot change order');
reset role;
select ok(not prosecdef,'core stays security invoker') from pg_proc where oid='private.apply_blueprint_proposal_core(uuid,bigint,uuid)'::regprocedure;
select ok(not has_function_privilege('service_role','private.apply_blueprint_proposal_core(uuid,bigint,uuid)','EXECUTE'),'service has no direct core bypass');
select finish();
rollback;
